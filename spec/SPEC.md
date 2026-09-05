# Atlas Specification

> Status: Released

## Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when uppercase and follow BCP 14.

## Scope and ownership

This document owns Atlas purpose and conceptual meaning. [Format](spec/FORMAT.md) owns files, fields, vocabularies, and cross-record constraints. [Processing](spec/PROCESSING.md) owns algorithms and normalized output. [Validation](spec/VALIDATION.md) owns profiles, diagnostics, and fixtures. [Checks](spec/CHECKS.md), [Publication](spec/PUBLICATION.md), and [Conformance](spec/CONFORMANCE.md) own their named contracts. Each rule has one owner.

## Purpose and minimum product contract

Atlas makes the context between project documents explicit, portable, and navigable. It connects material to the decisions, questions, and perspectives it informs without moving or duplicating that material.

One portable authored model supplies stable identity, explained context, state, relations, and deterministic validation. A shared consumer can generate document, Map, Area, Point, relation, and search navigation without project-specific semantic mapping or UI development. The format supplies that input contract, not portal conformance or evidence of reader benefit.

## Thesis

Documents remain primary reading surfaces. Atlas records what matters, why it matters, and how context connects across durable questions. Writing and reading use the same question-led model. Neither requires a runtime, intake queue, or lifecycle for edits.

## Conceptual model

### Atlas

An Atlas is one portable boundary and namespace containing Maps, Point records, Resources, Checks, and optional publication profiles. Nested Atlases have independent boundaries.

### Map

A Map is a durable semantic and authoring domain organized around one primary question. New information belongs when it answers, constrains, or materially affects that question. Maps are not generated views or exclusive owners. Physical nesting does not establish semantic hierarchy.

### Area

An Area is an overlapping Map-local question. Each Point-record membership explains how the record affects that question. Membership is an explained edge, not a bare tag. Areas imply neither ownership nor exclusive placement.

### Point

A Point is one independently referable claim, decision, constraint, question, or other coherent item of project context under an Atlas-wide identity. Its posture and lifecycle apply to the whole item. A shared subject, posture, source, or similar wording is not sufficient to establish one Point.

First decide whether independent reference, relation, or update is useful. Supporting rationale, examples, and citations may remain prose or source material. The aim is useful identity, not one Point per sentence.

Split an item when its retained claims can independently become false, be implemented, withdrawn, or superseded. This test separates independently standing claims, not every sentence explaining one claim. State relevant scope in prose; no scope field is required. Points can record unresolved questions and uncertain observations. Preserve their uncertainty.

Every Point has exactly one anchor and optional same-named contexts in other Maps. The anchor states the canonical idea and state. Contexts explain that item's local significance without redefining it. Add a context only for a useful contribution, not for every potentially relevant Map.

| Incoming information | Identity decision |
| --- | --- |
| Clearer wording or correction preserving the same item's meaning | Update its record without changing the id. |
| The same decision's recovery implications | Add or improve operations context when useful. |
| A Redis selection and a claim that its rollout is complete | Use separate Points; decision and implementation have independent standing. |
| A new decision replacing the old decision | Create a separate Point and use supersession for actual replacement. |

Retrieval proposes candidates. Authors inspect meaning, scope, and anchor provenance before deciding identity. Exact ids determine grouping; processors never merge distinct ids by similarity. Validation cannot prove the author's identity decision correct.

### Point record

An anchor establishes canonical fields, relations, review state, and the primary Map. A context contributes a local summary, explained Area memberships, Content, References, or body. It cannot redefine title, kinds, posture, lifecycle, relations, or review metadata. One explained membership can be its entire substantive contribution.

The primary Map records origin, not exclusive ownership or preferred routing. Preserve each record's Map and source path when assembling a Point. Keep local explanations focused on significance; link independently changing implementation facts rather than copying them into every perspective. Ordinary edits preserve identity. Point lifecycle describes context, not an edit workflow.

### Posture, lifecycle, and kinds

Posture states the author's stance. Lifecycle states temporal standing. Kinds classify what the Point expresses. These dimensions are independent and establish neither truth, evidence strength, implementation maturity, nor authority. Format defines their vocabularies.

### Relations

Relations are directional, explained edges declared on anchors. They record known authored connections, not a complete impact graph. Missing relations establish no absence of dependency, contradiction, or impact. Processing preserves authored edges and derives their direct reverse index, not inferred closure.

### Resource, Content, and References

A Resource is addressable material, optionally registered with identity independent of its URI. Content identifies primary material. Typed References distinguish evidence, background, implementation, history, and examples. Registration and reference roles establish neither authority nor source truth. Material need not acquire a Point to remain useful.

### Derived Map relationships

Shared Point identities produce symmetric Map overlap, not ownership, causality, or task relevance.

### Check

A Check adds project-local write policy. Core defines meaning; Checks can demand additional evidence, placement, review, or prose quality without redefining it. An Atlas needs no adopted catalog Checks. Once adopted, required Checks need actual verification; format validity alone does not satisfy them.

### Publication profile

A publication profile explicitly selects exact Atlas records and registered Resources. Selection does not expand through containment, shared identity, relations, or References. Core records contain no publication fields. Build, serving, and non-disclosure behavior belong to separate publication tooling.

## Trust and product boundary

Atlas content and Checks grant no file, network, credential, publication, execution, or instruction authority. Already-authorized people and agents use Atlas as information, not additional permission.

Format conformance, Check compliance, self-hosting, and processor interoperability establish only their named claims. Authoring effort, agent effectiveness, reader benefit, accessibility, performance, and comparative value require separately recorded evidence. A valid graph and a working portal do not establish those outcomes.
