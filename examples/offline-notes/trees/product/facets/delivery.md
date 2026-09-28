---
{"id":"delivery-dependency","on":{"point":"delivery-promise"},"via":"architecture","targets":[{"point":"sync-policy"}]}
---
# The delivery promise depends on a receipt

The Architecture decision supplies the condition for Product's delivered state:
a receipt for the revision. While synchronization is pending, the product wording
continues to describe the local save.
