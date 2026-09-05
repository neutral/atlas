---
{
  "type": "point",
  "record": "anchor",
  "id": "client-delivery",
  "title": "Client delivery",
  "summary": "Client delivery uses the edge gateway.",
  "kinds": [
    "implementation"
  ],
  "posture": "asserted",
  "lifecycle": "active",
  "areas": [
    {
      "area": "dependencies",
      "context": "Client delivery names its direct dependency on the edge gateway."
    }
  ],
  "relations": [
    {
      "type": "depends-on",
      "point": "edge-gateway",
      "note": "Client delivery sends requests through the edge gateway."
    }
  ]
}
---

# Client delivery

Client delivery depends directly on the edge gateway for request handling.
