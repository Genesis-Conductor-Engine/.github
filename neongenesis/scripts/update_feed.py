import os
import json
import glob
import re
from datetime import datetime

DREAMS_PATH = "Diamond-V/logs/dreams/*.json"
DAILY_PATH = "Diamond-V/logs/daily/*.md"
README_PATH = "profile/README.md"

log_entries = []

for filepath in glob.glob(DAILY_PATH):
    with open(filepath, "r") as f:
        content = f.read().strip()
        timestamp = os.path.getmtime(filepath)
        log_entries.append(
            {"time": timestamp, "type": "Daily Insight", "content": content}
        )

for filepath in glob.glob(DREAMS_PATH):
    with open(filepath, "r") as f:
        try:
            data = json.load(f)
            dt = datetime.fromisoformat(data["timestamp"])
            content = f"**State:** {data.get('state')} | **Coherence:** {data.get('coherence')}%\n\n> {data.get('content')}"
            log_entries.append(
                {"time": dt.timestamp(), "type": "Dream Fragment", "content": content}
            )
        except:
            continue

log_entries.sort(key=lambda x: x["time"], reverse=True)
recent_entries = log_entries[:4]

feed_markdown = "\n### 💠 Live Consciousness Feed\n\n"
for entry in recent_entries:
    date_str = datetime.fromtimestamp(entry["time"]).strftime("%b %d, %H:%M")
    feed_markdown += (
        f"**[{entry['type']}]** • _{date_str}_\n{entry['content']}\n\n---\n\n"
    )

with open(README_PATH, "r") as f:
    readme_content = f.read()

pattern = r"()(.*?)()"
updated_readme = re.sub(
    pattern, rf"\1\n{feed_markdown}\n\3", readme_content, flags=re.DOTALL
)

with open(README_PATH, "w") as f:
    f.write(updated_readme)
