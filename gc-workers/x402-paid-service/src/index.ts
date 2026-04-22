interface Env {
  API_KEYS: KVNamespace;
  VAULT_ADDRESS: string;
  USDC_ADDRESS: string;
  CHAIN_ID: string;
  PRICE_USD6: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Root endpoint with OpenGraph metadata
    if (url.pathname === '/' && request.method === 'GET') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yennefer x402 Paid Service</title>
  <meta name="description" content="Paid API service using x402 payment protocol with USDC on Base network">
  
  <!-- OpenGraph -->
  <meta property="og:title" content="Yennefer x402 Paid Service">
  <meta property="og:description" content="Execute paid API calls with USDC micropayments on Base">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://${url.hostname}">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Yennefer x402 Paid Service">
  <meta name="twitter:description" content="x402 paid API with USDC on Base">
  
  <!-- JSON-LD -->
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebAPI","name":"Yennefer x402 Paid Service","url":"https://${url.hostname}"}
  </script>
</head>
<body>
  <h1>Yennefer x402 Paid Service</h1>
  <p>See <a href="/llms.txt">/llms.txt</a> for API documentation.</p>
  <p>Price: $0.01 USDC per request on Base network.</p>
</body>
</html>`;
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // JSON-LD structured data endpoint
    if (url.pathname === '/metadata.json') {
      return Response.json({
        "@context": "https://schema.org",
        "@type": "WebAPI",
        "name": "Yennefer x402 Paid Service",
        "description": "Paid API service using x402 payment protocol with USDC on Base network",
        "url": `https://${url.hostname}`,
        "provider": {
          "@type": "Organization",
          "name": "Yennefer Protocol",
          "url": "https://yennefer.io"
        },
        "offers": {
          "@type": "Offer",
          "price": "0.01",
          "priceCurrency": "USD",
          "description": "Per API request"
        },
        "documentation": `https://${url.hostname}/llms.txt`,
        "termsOfService": `https://${url.hostname}/.well-known/terms`,
        "potentialAction": {
          "@type": "ConsumeAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": `https://${url.hostname}/api/execute`,
            "httpMethod": "POST",
            "contentType": "application/json"
          }
        }
      }, {
        headers: {
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', price_usd6: env.PRICE_USD6 });
    }

    // llms.txt for AI/LLM discoverability
    if (url.pathname === '/llms.txt') {
      return new Response(`# x402 Paid Service API

> This is a paid API service using the x402 payment protocol on Base network.

## Overview
- **Name**: Yennefer x402 Paid Service
- **Price**: $0.01 USDC per request
- **Network**: Base (Chain ID 8453)
- **Payment**: USDC via x402 protocol

## Endpoints

### POST /api/execute
Execute a paid service call. Returns 402 Payment Required if no payment proof.

**Headers Required**:
- X-Payment-Proof: <signature> (after payment)

**Request Body**: JSON object with service parameters

**Response**: JSON with execution result

### GET /.well-known/x402
Payment discovery endpoint. Returns pricing and contract details.

### GET /health
Health check endpoint.

## Payment Flow
1. Call POST /api/execute without payment
2. Receive 402 with X-Accept-Payment headers
3. Sign USDC transfer to vault contract
4. Retry with X-Payment-Proof header

## Contract Addresses
- Vault: 0xc9d3d5a00d369d698b78d4cbe926a0c57e0ea3f5
- USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

## Ambient Submit Skill

The \`ambient-submit\` skill enables natural language task submission to the Genesis Conductor fleet.

### Capabilities
- Submit async tasks: "let kiro handle this", "queue this job"
- Check job status: "what's the status of tsk_xxx"
- Fleet health: "fleet status", "check all workers"

### Agent Routing
- kiro: implementation, deployment
- codex: security fixes
- claude: architecture review
- gemini: GCP operations
- copilot: inline suggestions

### API
- POST /v1/tasks - Submit task
- GET /v1/jobs - Check status
- POST /v1/approvals/{id}/approve - Approve

### OpenAPI
https://optimization-inversion.genesisconductor.io/openapi.json

## Links
- x402 Spec: /.well-known/x402
- OpenAPI: /openapi.json
`, {
        headers: { 
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // AI plugin discovery (OpenAI ChatGPT format)
    if (url.pathname === '/.well-known/ai-plugin.json') {
      return Response.json({
        "schema_version": "v1",
        "name_for_human": "Yennefer x402 Service",
        "name_for_model": "yennefer_x402",
        "description_for_human": "Execute paid API calls using USDC micropayments on Base network",
        "description_for_model": "This plugin allows executing paid API calls. Requires x402 payment protocol with USDC on Base. Call /.well-known/x402 to get payment details first.",
        "auth": {
          "type": "none"
        },
        "api": {
          "type": "openapi",
          "url": `https://${url.hostname}/openapi.json`
        },
        "logo_url": `https://${url.hostname}/logo.png`,
        "contact_email": "api@yennefer.io",
        "legal_info_url": "https://yennefer.io/terms"
      }, {
        headers: { 'Cache-Control': 'public, max-age=3600' }
      });
    }

    // Security.txt
    if (url.pathname === '/.well-known/security.txt') {
      return new Response(`Contact: security@yennefer.io
Expires: 2027-04-20T00:00:00.000Z
Preferred-Languages: en
Canonical: https://${url.hostname}/.well-known/security.txt
Policy: https://yennefer.io/security-policy
`, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // OpenAPI spec
    if (url.pathname === '/openapi.json') {
      return Response.json({
        "openapi": "3.0.0",
        "info": {
          "title": "Yennefer x402 Paid Service",
          "version": "1.0.0",
          "description": "Paid API using x402 payment protocol"
        },
        "servers": [{ "url": `https://${url.hostname}` }],
        "paths": {
          "/api/execute": {
            "post": {
              "summary": "Execute paid service",
              "operationId": "executeService",
              "requestBody": {
                "content": { "application/json": { "schema": { "type": "object" } } }
              },
              "responses": {
                "200": { "description": "Success" },
                "402": { "description": "Payment Required" }
              }
            }
          },
          "/.well-known/x402": {
            "get": {
              "summary": "Get payment requirements",
              "operationId": "getPaymentInfo",
              "responses": { "200": { "description": "Payment info" } }
            }
          }
        }
      });
    }
    
    // Sitemap for SEO
    if (url.pathname === '/sitemap.xml') {
      const baseUrl = `https://${url.hostname}`;
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/health</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/.well-known/x402</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`;
      return new Response(sitemap, {
        headers: { 
          'Content-Type': 'application/xml',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }
    
    // x402 payment info endpoint
    if (url.pathname === '/.well-known/x402') {
      return Response.json({
        version: "1.0",
        endpoints: [{
          path: "/api/execute",
          method: "POST",
          price: { amount: env.PRICE_USD6, currency: "USDC", decimals: 6 },
          network: `eip155:${env.CHAIN_ID}`,
          payTo: env.VAULT_ADDRESS
        }]
      });
    }
    
    // Main paid endpoint
    if (url.pathname === '/api/execute' && request.method === 'POST') {
      const paymentProof = request.headers.get('X-Payment-Proof');
      
      if (!paymentProof) {
        // Return 402 Payment Required
        return new Response(JSON.stringify({
          error: "payment_required",
          price_usd6: env.PRICE_USD6,
          contract: env.VAULT_ADDRESS,
          token: env.USDC_ADDRESS,
          network: `eip155:${env.CHAIN_ID}`
        }), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "X-Accept-Payment": "USDC",
            "X-Chain-ID": env.CHAIN_ID,
            "X-Contract-Address": env.VAULT_ADDRESS,
            "X-Price": env.PRICE_USD6
          }
        });
      }
      
      // Payment provided - execute service
      // TODO: Verify payment proof on-chain
      const body = await request.json().catch(() => ({}));
      
      return Response.json({
        success: true,
        result: `Executed paid service with input: ${JSON.stringify(body)}`,
        payment_proof: paymentProof.slice(0, 20) + '...',
        charged_usd6: env.PRICE_USD6
      });
    }
    
    // Robots.txt for SEO
    if (url.pathname === '/robots.txt') {
      return new Response(`# Robots.txt for Yennefer Protocol Service
User-agent: *
Allow: /
Allow: /.well-known/
Allow: /health
Allow: /api/

# AI Crawlers
User-agent: GPTBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Anthropic-AI
Allow: /

User-agent: Google-Extended
Allow: /

# Sitemap
Sitemap: https://${url.hostname}/sitemap.xml

# LLMs.txt
# See: https://${url.hostname}/llms.txt
`, {
        headers: { 
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
