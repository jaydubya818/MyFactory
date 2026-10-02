# Harness-neutral environments and future cloud computer access

Status: **contract support implemented; CLOUD_COMPUTER runtime DEFERRED / NOT_QUALIFIED**. This extension does not gate or replace the active cloud owner's existing harness → deterministic cloud execution → independent verifier → Mac-off Golden Journey → P0 sequence.

## Separation of responsibilities

Work → MyFactory → EnvironmentRouter → ExecutionEnvironment → ExecutionProvider → HarnessProvider → optional SessionSurfaceProvider.

| Layer | Answers | Boundary |
| --- | --- | --- |
| ExecutionEnvironment | Where can this Work execute? | Resource identity, owner/business scope, availability, capacity, protocol and qualified capabilities |
| ExecutionProvider | How are those resources prepared, started, observed and torn down? | Resource lifecycle under canonical admission and fencing; no agent/harness brand in the interface |
| HarnessProvider / existing harness boundary | How does agentic Work execute? | Separately qualified agent loop, tools/model transport and execution constraints |
| SessionSurfaceProvider | How does an operator observe or attach? | Optional presentation; no productive lifecycle or authority |

The environment descriptor and ExecutionProvider interface contain no Codex, Claude Code, DeepAgent or Cursor selector. `provider` identifies resource provisioning, not an agent harness. Runtime and FactoryVersion are opaque immutable pins: the admitted composition can bind a particular qualified harness version without making harness brands environment types or routing roles. Changing that composition still requires qualification; neutrality is not permission to hot-swap a harness during Work.

Implemented reality: the legacy LocalExecutionProvider/JobManager composition still delegates readiness and execution to the existing Codex adapter. ExecutionGateway retains its existing host-owned metering contract. This checkpoint does not refactor that qualified loop, claim interchangeable live harnesses, or introduce another harness implementation. Concrete harness-specific behavior remains behind the execution boundary. DeepAgent and other alternatives require their own qualification; no new harness is launch-critical. The separate cloud provider/controller is owned by Cloud Execution and was rechecked at `faf93359a4c54daaf3e0b713a601366db02ba8d6` without edits to its checkout.

## Future CLOUD_COMPUTER profile

CLOUD_COMPUTER names a future qualified capability profile of **CLOUD**, not a fourth EnvironmentType, new agent identity, default cloud feature, or blanket permission. Environment types remain CLOUD, OWNER_COMPUTER and LOCAL_FACTORY. The existing descriptor supports these independently versioned execution capabilities:

| Capability | Intended future access |
| --- | --- |
| `browser` | Bounded browser interaction in an admitted environment |
| `desktop` | Bounded desktop interaction |
| `screenshot` | Bounded screen capture |
| `appInteraction` | Bounded interaction with allowed applications |

A CLOUD environment may expose none, a subset, or all of them. `browser` and `appInteraction` extend the existing vocabulary; `desktop` and `screenshot` retain their existing meaning. No adapter automatically advertises new capabilities. No cloud browser, desktop service, app launcher or capture implementation is added. `session.browser` means operator presentation and does not satisfy an agent's `browser` requirement. A visible browser pane does not authorize automation.

An agent receives bounded access to a qualified environment; it does not own a computer. Qualification and policy must bind the exact environment/runtime, capability version, allowed resource/application/domain, action scope, credentials, owner/business, Work/attempt/generation and expiry. Existing admission/Relay grants and effect-time revocation/fencing remain authoritative. Before implementation, qualify desktop isolation, screenshot redaction, app/browser scopes, cross-Work and cross-owner denial, secret/holdout protection, teardown and custody. Capability matching alone proves none of those connected properties.

## Identity-independent routing

Software Engineer, Designer, Researcher, Sofie and future specialists retain their agent identities across environments. There is no Software Engineer=CLOUD, Designer=CLOUD_COMPUTER or Sofie=OWNER_COMPUTER mapping. The router accepts capabilities and trusted resource/policy restrictions, owner/business authority, independent qualification and availability; it does not accept specialist role or harness choice as routing authority.

Existing resource policy is preserved: repository/background Work selects CLOUD, a real owner-local file/desktop requirement pins the owner's device, and explicit local qualification selects LOCAL_FACTORY. Those are resource constraints, not agent-role defaults. The derivation function now explicitly projects canonical Work fields instead of spreading incidental agent/harness metadata into requirements. Owner/agent identity is neither replaced nor inferred from the chosen environment. A new Work or explicitly admitted generation can bind another environment; an active binding is not silently migrated.

Future trusted policy may request `browser`, `desktop`, `screenshot` or `appInteraction` against CLOUD using the existing WorkRequirements. Each requested capability needs supported advertisement, independent exact-environment qualification and existing Work authority. Missing/unqualified/unavailable capabilities wait; unauthorized capabilities deny. A capable Mac does not become fallback for an explicitly cloud-bound request. The future natural-language resource derivation and tool transport remain unimplemented.

## Capability authority and extensibility

Advertisement describes technical availability; qualification supplies independent evidence; Work authority and Relay policy decide whether this Work may use it. All are required where applicable. A qualified `desktop`, `browser`, `git` or `shell` advertisement cannot create, widen or renew a grant. The pure Fabric router checks its bounded Work authority input; production integration must also retain existing Relay authorization and effect-time fencing/revocation. These tests do not claim connected Relay qualification.

Additional owner computers, cloud computer profiles and qualified sandboxes are additional environment descriptors with distinct IDs and exact runtime/provider qualification. They do not require new Work semantics, agent identities, one-computer-per-agent allocation, or another orchestration layer. Grant environment IDs explicitly; qualify each identity independently. More than one agent may be authorized to use an environment over time, and one agent may use multiple environments for separately admitted Work; capacity and current claims still limit concurrency.

Within an eligible environment type, candidate selection is deterministic by stable ID after policy, owner/business scope, exact resource pin, Work grant, availability, protocol and qualification filters. A newly registered instance cannot inherit another instance's qualification or permissions. Adding a candidate affects only fresh admission; existing Work retains its bound identity and never silently migrates. An owner-local resource continues waiting for its exact device even when another fully authorized/qualified computer is online. Unsupported protocols/capabilities fail closed. A genuinely new environment class would require a versioned descriptor/protocol extension, not a rewrite of Work, proof, agent identity or owner decisions.

Implemented reality: these are deterministic pure routing contracts; durable Fabric registry and production routing integration remain pending. The production integration must preserve this policy and evidence boundary; passing fixtures do not enable a new route.

The Cloud Execution owner's newer documentation checkpoint `449f6daca02036a6a800a088cd7389437b7f3705` was reviewed for this addendum. Its [HarnessProvider contract](https://github.com/jaydubya818/MyFactory/blob/449f6daca02036a6a800a088cd7389437b7f3705/docs/architecture/harness-provider.md) independently preserves the same separation and current qualification order. No controller/provider changes or protected-checkout edits were made here.

## Evidence and next ownership boundary

[Deterministic contracts](../environment-fabric/evidence/harness-neutral-contracts.txt) cover all five named/example specialist roles across all three environment types, unchanged agent input, identical resource-derived requirements/digests, rejection of harness/agent fields in environment descriptors, independent computer-capability subsets, and absent/unavailable/incompatible/unqualified/unauthorized denial for each computer capability. These fixtures are not a live cloud computer qualification.

The [qualification addendum](../environment-fabric/harness-neutral.md) records the checkpoint. No production admission, paid calls, publication, cloud resource allocation or operator surface was enabled. Cloud Execution continues its current HEADLESS milestone; optional computer and session adapters follow only after that critical path.
