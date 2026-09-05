---
{
  "type": "point",
  "record": "anchor",
  "id": "edge-gateway",
  "title": "Edge gateway",
  "summary": "The edge gateway uses the regional network.",
  "kinds": [
    "implementation"
  ],
  "posture": "asserted",
  "lifecycle": "active",
  "areas": [
    {
      "area": "dependencies",
      "context": "The edge gateway names its direct dependency on the regional network."
    }
  ],
  "relations": [
    {
      "type": "depends-on",
      "point": "regional-network",
      "note": "The edge gateway sends regional traffic through the network."
    }
  ]
}
---

# Edge gateway

The edge gateway depends directly on the regional network for transport.
