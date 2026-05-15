UPDATE workflow_entity
SET
  nodes = $nodes$[
    {
      "id": "8b018827-111e-4cdf-ab53-cbd4bd0f3f9b",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "position": [0, 0],
      "webhookId": "a3785d44-3b73-4d2c-9ab9-3eab80eb806b",
      "parameters": {
        "path": "fittracker-events",
        "options": {},
        "httpMethod": "POST",
        "authentication": "headerAuth"
      },
      "credentials": {
        "httpHeaderAuth": {"id": "UfpjcuDpAGiqFPjZ", "name": "Header Auth account"}
      },
      "typeVersion": 2.1
    },
    {
      "id": "76760a12-2c4c-449a-aaf9-e7915028d0f7",
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "position": [208, 0],
      "parameters": {
        "url": "http://127.0.0.1:3000/api/v1/n8n/build-prompt",
        "method": "POST",
        "options": {},
        "jsonBody": "={{ JSON.stringify($json) }}\n",
        "sendBody": true,
        "sendHeaders": true,
        "specifyBody": "json",
        "headerParameters": {
          "parameters": [{"name": "x-n8n-secret", "value": "6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b"}]
        }
      },
      "typeVersion": 4.4
    },
    {
      "id": "e9fdfa31-17de-45bb-b1df-fe951c315743",
      "name": "Ollama",
      "type": "n8n-nodes-base.httpRequest",
      "position": [420, 0],
      "parameters": {
        "url": "http://127.0.0.1:11434/api/chat",
        "method": "POST",
        "options": {},
        "jsonBody": "={{ JSON.stringify({model: 'llama3.2', messages: [{role: 'user', content: $json.prompt}], stream: false}) }}",
        "sendBody": true,
        "specifyBody": "json"
      },
      "typeVersion": 4.4
    },
    {
      "id": "cbea5bf3-f965-40b8-b957-aa7e6ea49473",
      "name": "HTTP Request1",
      "type": "n8n-nodes-base.httpRequest",
      "position": [640, 0],
      "parameters": {
        "url": "http://127.0.0.1:3000/api/v1/n8n/callback",
        "method": "POST",
        "options": {},
        "jsonBody": "={\n  \"accountId\": \"{{ $('Webhook').item.json.accountId }}\",\n  \"event\": \"{{ $('Webhook').item.json.event }}\",\n  \"suggestionType\": \"{{ $('HTTP Request').item.json.suggestionType }}\",\n  \"suggestion\": \"{{ $json.message.content }}\"\n}\n",
        "sendBody": true,
        "sendHeaders": true,
        "specifyBody": "json",
        "headerParameters": {
          "parameters": [{"name": "x-n8n-secret", "value": "6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b"}]
        }
      },
      "typeVersion": 4.4
    }
  ]$nodes$::jsonb,
  connections = $conn${
    "Webhook":        {"main": [[{"node": "HTTP Request", "type": "main", "index": 0}]]},
    "HTTP Request":   {"main": [[{"node": "Ollama",       "type": "main", "index": 0}]]},
    "Ollama":         {"main": [[{"node": "HTTP Request1","type": "main", "index": 0}]]}
  }$conn$::jsonb,
  "updatedAt" = NOW()
WHERE id = 'U7fHPfZF9vwTdF28';
