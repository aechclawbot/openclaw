Run the OASIS real-time system monitor. Follow the instructions in `oasis/skills/oasis-monitor/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-monitor/SKILL.md`
2. Show container status (running/healthy for all 4 containers)
3. Check port health (18789, 3000, 9001)
4. Show disk usage
5. Run `docker stats --no-stream` for resource usage
6. Check audio pipeline status (listener health, queue depth, PulseAudio)
7. Show launchd service status
8. Show health alert state
9. Show gateway health info
