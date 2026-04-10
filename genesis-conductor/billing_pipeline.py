"""
Genesis Conductor — Billing Pipeline
JSONL telemetry -> Cloudflare D1 (genesis-seismic-log) -> Stripe metered usage

Usage:
    python billing_pipeline.py --telemetry-path /path/to/telemetry.jsonl --mode ingest
    python billing_pipeline.py --mode report --period-hours 24
    python billing_pipeline.py --mode stripe-flush   # push pending D1 rows to Stripe
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

# ── Config from env ───────────────────────────────────────────────────────────
CF_ACCOUNT_ID    = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN     = os.environ.get("CF_API_TOKEN", "")
CF_D1_DB_ID      = os.environ.get("CF_D1_DATABASE_ID", "b3882029-21b8-44c0-a059-a51e33721546")
STRIPE_SECRET    = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_METER     = os.environ.get("STRIPE_METER_EVENT", "qflop_produced")
STRIPE_SUB_ITEM  = os.environ.get("STRIPE_SUBSCRIPTION_ITEM_ID", "")  # set after Stripe product created
L1_RPC_URL       = os.environ.get("L1_RPC_URL", "")
ETHERSCAN_API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")

CF_D1_BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}"


# ── D1 helpers ────────────────────────────────────────────────────────────────
def d1_query(sql: str, params: list = None) -> dict:
    """Execute SQL against genesis-seismic-log D1."""
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
    body = {"sql": sql, "params": params or []}
    r = requests.post(f"{CF_D1_BASE}/query", headers=headers, json=body, timeout=15)
    r.raise_for_status()
    result = r.json()
    if not result.get("success"):
        raise RuntimeError(f"D1 query failed: {result}")
    return result["result"][0] if result["result"] else {}


def d1_batch(statements: list[dict]) -> None:
    """Execute a batch of SQL statements atomically."""
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
    r = requests.post(f"{CF_D1_BASE}/raw", headers=headers,
                      json={"sql": "; ".join(s["sql"] for s in statements)}, timeout=30)
    r.raise_for_status()


# ── Etherscan gas oracle ──────────────────────────────────────────────────────
def fetch_etherscan_gas(api_key: str) -> dict:
    """Fetch current gas prices from Etherscan gasoracle endpoint (primary source)."""
    if not api_key:
        return {}
    try:
        r = requests.get(
            "https://api.etherscan.io/api",
            params={"module": "gastracker", "action": "gasoracle", "apikey": api_key},
            timeout=5,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "1":
            raise RuntimeError(f"Etherscan error: {data.get('message')}")
        result = data["result"]
        base_fee = float(result.get("suggestBaseFee", result.get("SafeGasPrice", 0)))
        fast_fee = float(result.get("FastGasPrice", 0))
        priority_fee = max(0.0, round(fast_fee - base_fee, 4))
        return {
            "gas_base_fee_gwei": round(base_fee, 4),
            "gas_priority_fee_gwei": priority_fee,
            "gas_source": "etherscan",
        }
    except Exception as e:
        print(f"[warn] Etherscan gas fetch failed: {e}")
        return {}


# ── L1 gas oracle (fallback) ──────────────────────────────────────────────────
def fetch_l1_gas() -> dict:
    """Pull current L1 gas data from yenn BNE."""
    if not L1_RPC_URL:
        return {}
    try:
        block_r = requests.post(L1_RPC_URL,
            json={"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",False],"id":1},
            timeout=5).json()
        fee_r = requests.post(L1_RPC_URL,
            json={"jsonrpc":"2.0","method":"eth_feeHistory","params":[10,"latest",[50]],"id":2},
            timeout=5).json()

        block = block_r.get("result", {})
        base_fee = int(block.get("baseFeePerGas", "0x0"), 16) / 1e9
        block_num = int(block.get("number", "0x0"), 16)
        block_hash = block.get("hash", "")

        priority_fees = []
        for rewards in fee_r.get("result", {}).get("reward", []):
            if rewards:
                priority_fees.append(int(rewards[0], 16) / 1e9)
        priority_fee = sum(priority_fees) / len(priority_fees) if priority_fees else 0

        return {
            "gas_base_fee_gwei": round(base_fee, 4),
            "gas_priority_fee_gwei": round(priority_fee, 4),
            "l1_block_number": block_num,
            "l1_block_hash": block_hash,
        }
    except Exception as e:
        print(f"[warn] L1 gas fetch failed: {e}")
        return {}


# ── Stripe metered billing ────────────────────────────────────────────────────
def stripe_report_usage(quantity: float, timestamp: int, idempotency_key: str) -> Optional[str]:
    """Report QFLOP usage to Stripe metered billing."""
    if not STRIPE_SECRET or not STRIPE_SUB_ITEM:
        print("[warn] Stripe not configured — skipping usage report")
        return None
    try:
        # Stripe v2 meter events API
        r = requests.post(
            "https://api.stripe.com/v2/billing/meter_events",
            auth=(STRIPE_SECRET, ""),
            data={
                "event_name": STRIPE_METER,
                "payload[value]": str(int(quantity)),
                "payload[stripe_customer_id]": os.environ.get("STRIPE_CUSTOMER_ID", ""),
                "timestamp": str(timestamp),
                "identifier": idempotency_key,
            },
            timeout=10,
        )
        result = r.json()
        if r.status_code in (200, 201):
            return result.get("id", "ok")
        else:
            print(f"[warn] Stripe usage report failed: {result}")
            return None
    except Exception as e:
        print(f"[warn] Stripe request failed: {e}")
        return None


# ── JSONL ingestion ───────────────────────────────────────────────────────────
def ingest_telemetry(telemetry_path: str) -> int:
    """Read Genesis Conductor JSONL telemetry -> insert into D1 qflop_telemetry."""
    path = Path(telemetry_path)
    if not path.exists():
        print(f"[error] Telemetry file not found: {telemetry_path}")
        return 0

    # Etherscan is primary; fall back to L1 RPC if Etherscan is unavailable
    l1_gas = fetch_etherscan_gas(ETHERSCAN_API_KEY)
    if not l1_gas:
        l1_gas = fetch_l1_gas()
        if l1_gas:
            l1_gas["gas_source"] = "l1_rpc"
    gas_source = l1_gas.get("gas_source", "unavailable")
    print(f"[ingest] Gas price source: {gas_source} "
          f"(base={l1_gas.get('gas_base_fee_gwei', 'n/a')} Gwei)")
    inserted = 0
    batch = []

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Genesis Conductor telemetry schema fields
            cycle_id          = rec.get("cycle_id", str(uuid.uuid4()))
            ts                = rec.get("ts", datetime.now(timezone.utc).isoformat())
            qflop_produced    = float(rec.get("qflop_produced_per_cycle", rec.get("qflop_produced", 0)))
            qflop_cumulative  = float(rec.get("qflop_cumulative", 0))
            profitability     = float(rec.get("profitability_score", 0))
            l2_block          = int(rec.get("l2_block_number", 0))

            sql = """
                INSERT OR IGNORE INTO qflop_telemetry
                (ts, cycle_id, qflop_produced, qflop_cumulative,
                 gas_base_fee_gwei, gas_priority_fee_gwei,
                 profitability_score, l1_block_number, l1_block_hash,
                 l2_block_number, chain, mode)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """
            params = [
                ts, cycle_id, qflop_produced, qflop_cumulative,
                l1_gas.get("gas_base_fee_gwei"),
                l1_gas.get("gas_priority_fee_gwei"),
                profitability,
                l1_gas.get("l1_block_number"),
                l1_gas.get("l1_block_hash"),
                l2_block,
                "base-mainnet",
                "paper_live",
            ]
            try:
                d1_query(sql, params)
                inserted += 1
            except Exception as e:
                print(f"[warn] D1 insert failed for cycle {cycle_id}: {e}")

    print(f"[ingest] {inserted} cycles written to D1 genesis-seismic-log.qflop_telemetry")
    return inserted


# ── Stripe flush ──────────────────────────────────────────────────────────────
def stripe_flush(period_hours: int = 1) -> None:
    """Aggregate unreported D1 rows -> single Stripe metered usage event."""
    result = d1_query("""
        SELECT
            COUNT(*) as cycles,
            SUM(qflop_produced) as total_qflop,
            MIN(ts) as period_start,
            MAX(ts) as period_end
        FROM qflop_telemetry
        WHERE stripe_reported = 0
    """)
    rows = result.get("results", [{}])
    if not rows or not rows[0].get("total_qflop"):
        print("[stripe-flush] No unreported cycles")
        return

    row = rows[0]
    total_qflop   = float(row["total_qflop"])
    period_start  = row["period_start"]
    period_end    = row["period_end"]
    idempotency   = f"gc-{period_start}-{period_end}".replace(":", "-").replace(".", "-")

    print(f"[stripe-flush] Reporting {total_qflop:,.0f} QFLOP | {row['cycles']} cycles | {period_start} -> {period_end}")

    usage_id = stripe_report_usage(total_qflop, int(time.time()), idempotency)

    # Log to billing_events
    d1_query("""
        INSERT INTO billing_events
        (stripe_subscription_item_id, qflop_quantity, period_start, period_end, stripe_usage_record_id, status)
        VALUES (?,?,?,?,?,?)
    """, [STRIPE_SUB_ITEM, total_qflop, period_start, period_end,
          usage_id or "pending", "reported" if usage_id else "pending"])

    if usage_id:
        # Mark rows as reported
        d1_query("UPDATE qflop_telemetry SET stripe_reported = 1 WHERE stripe_reported = 0")
        print(f"[stripe-flush] Stripe usage record: {usage_id}")
    else:
        print("[stripe-flush] Stripe report failed — rows remain pending")


# ── Report ────────────────────────────────────────────────────────────────────
def report() -> None:
    """Print summary from D1."""
    r = d1_query("""
        SELECT
            COUNT(*) as cycles,
            SUM(qflop_produced) as total_qflop,
            AVG(profitability_score) as avg_profit,
            AVG(gas_base_fee_gwei) as avg_base_fee,
            MIN(ts) as first_ts,
            MAX(ts) as last_ts,
            SUM(stripe_reported) as reported_cycles
        FROM qflop_telemetry
    """)
    rows = r.get("results", [{}])
    row = rows[0] if rows else {}

    print("\n-- Genesis Conductor D1 Report --")
    print(f"  Cycles recorded  : {row.get('cycles', 0):,}")
    print(f"  Total QFLOP      : {float(row.get('total_qflop') or 0):,.0f}")
    print(f"  Avg profit score : {float(row.get('avg_profit') or 0):.3f}")
    print(f"  Avg base fee     : {float(row.get('avg_base_fee') or 0):.2f} Gwei")
    print(f"  Stripe reported  : {row.get('reported_cycles', 0)} cycles")
    print(f"  Period           : {row.get('first_ts')} -> {row.get('last_ts')}")
    print("-" * 53 + "\n")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Genesis Conductor Billing Pipeline")
    parser.add_argument("--mode", choices=["ingest", "stripe-flush", "report", "full"],
                        default="full", help="Operation mode")
    parser.add_argument("--telemetry-path", default=os.environ.get("TELEMETRY_PATH", "telemetry.jsonl"))
    parser.add_argument("--period-hours", type=int, default=1)
    args = parser.parse_args()

    if args.mode in ("ingest", "full"):
        ingest_telemetry(args.telemetry_path)

    if args.mode in ("stripe-flush", "full"):
        stripe_flush(args.period_hours)

    if args.mode in ("report", "full"):
        report()
