# M001: Polish & Hardening

**Vision:** A clean, well-organized codebase with no dead code, complete type safety, and a modular webview — ready for feature development.

## Success Criteria

- Extension builds with zero TypeScript errors and no `as any` casts in message handlers
- All message types in `ExtensionToWebviewMessage` union match what the extension actually sends
- No dead code: followUpQueue, empty handlers, duplicate methods all removed
- Webview split into ≤300-line modules with clear responsibilities
- Full conversation flow works identically to pre-refactor behavior

## Key Risks / Unknowns

- Webview module split could break event handler wiring or state sharing — mitigated by splitting state into its own module first
- Removing "dead" code that's actually reachable via an uncommon path — verify each removal

## Proof Strategy

- Webview split risk → retire in S01 by proving the split webview builds and renders correctly
- Dead code risk → retire in S02 by verifying each removal against all call sites

## Verification Classes

- Contract verification: `npm run build` succeeds, VSIX packages without errors
- Integration verification: full conversation flow exercised in Extension Development Host
- Operational verification: streaming, tool calls, model picker, slash commands, inline UI all work
- UAT / human verification: visual check that rendering is identical to pre-refactor

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slices are complete and verified
- Extension builds cleanly and packages as VSIX
- Full conversation flow tested end-to-end in Extension Development Host
- Success criteria re-checked against live behavior

## Slices

- [x] **S01: Webview Module Split** `risk:high` `depends:[]`
  > After this: webview/index.ts is split into ~6 focused modules, extension builds and renders identically to before
- [x] **S02: Dead Code & Type Safety** `risk:medium` `depends:[S01]`
  > After this: no dead code, all message types complete, no `as any` in message handlers, duplicate RPC methods removed
- [x] **S03: Config & Build Cleanup** `risk:low` `depends:[S02]`
  > After this: tsconfig cleaned up, uncommitted changes committed as clean v0.2.1, README version bumped

## Boundary Map

### S01 → S02

Produces:
- Modular webview file structure with exported state object, render functions, and event handler setup
- Clear module boundaries: state.ts, helpers.ts, renderer.ts, slash-menu.ts, model-picker.ts, ui-dialogs.ts, index.ts (wiring)

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- Clean types.ts with all message types in the union
- Clean rpc-client.ts with no duplicate methods
- Clean webview-provider.ts with no empty handlers

Consumes:
- Modular webview structure from S01 (dead code removal touches the split modules)
