# Objective

Now that `ARCHITECTURE_SPEC.md` exists in the root directory, update our `/oasis-docs` testing framework to strictly enforce this specification.

# Execution Steps

Please perform the following implementations:

1. **Analyze Execution Flow:** Analyze the current execution flow of the testing scripts within `/oasis-docs`.
2. **Build Integration Layer:** Write an integration layer that allows `/oasis-docs` to read and parse `ARCHITECTURE_SPEC.md` as the source of truth for test assertions.
3. **Integration Tests:** Update `/oasis-docs` to verify the interface contracts between the Website, the Audio Process, and the OpenClaw agents match the expected inputs/outputs defined in the spec.
4. **Update Logging:** Modify the `/oasis-docs` output logs to explicitly state which architectural components passed or failed based on the `ARCHITECTURE_SPEC.md` definitions.

# Deliverables

Write the necessary code, update the relevant `/oasis-docs` scripts, and provide a brief explanation of your implementation.
