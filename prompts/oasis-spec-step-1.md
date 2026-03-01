# Role and Objective

Act as a Principal Solutions Architect. Conduct a deep-dive static analysis of this entire repository and generate a comprehensive, unified System Architecture and Technical Specification Document.

# Core Domains to Analyze

You must analyze and document the following four core domains:

1. **Docker Infrastructure:** Detail all `Dockerfile`s, `docker-compose.yml` configurations, network bridges, volume mounts, and environment variable dependencies.
2. **Website/Frontend:** Document the tech stack, routing structure, state management, and API integration points.
3. **Audio Process:** Detail the data flow, processing libraries, input/output formats, concurrency handling, and performance bottlenecks of the audio processing pipeline.
4. **OpenClaw Agents:** Map out the architecture of all OpenClaw agents, including their system prompts, tool access, inter-agent communication protocols, and triggering mechanisms.

# Formatting and Output Requirements

- Structure the document using standard architectural frameworks (e.g., C4 model concepts).
- Include a 'System Overview', 'Component Workflows', and 'API/Interface Contracts' section.
- Save this entire output directly to a new file named `ARCHITECTURE_SPEC.md` in the root of the project.
- Do not truncate the file; write the complete specification.
