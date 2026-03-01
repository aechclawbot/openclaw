/**
 * OASIS Dashboard 2.0 - Metrics Service
 * Performance metrics for agents, cron jobs, and system resources
 */

/**
 * Extract agentId from session key format "agent:<agentId>:<rest>"
 */
function extractAgentId(session) {
  if (session.agentId) {return session.agentId;}
  if (session.agent) {return session.agent;}
  if (session.key && typeof session.key === 'string') {
    const parts = session.key.split(':');
    if (parts.length >= 2 && parts[0] === 'agent') {return parts[1];}
  }
  return 'unknown';
}

/**
 * Get agent performance metrics
 */
export async function getAgentMetrics(rpcCall) {
  try {
    const result = await rpcCall('sessions.list', { limit: 500 });
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    const agents = {};

    // Aggregate metrics per agent
    for (const session of sessions) {
      const agentId = extractAgentId(session);

      if (!agents[agentId]) {
        agents[agentId] = {
          id: agentId,
          sessions: { total: 0, active: 0 },
          messages: 0,
          lastActivity: null,
        };
      }

      agents[agentId].sessions.total++;
      if (session.active) {agents[agentId].sessions.active++;}

      const ts = session.updatedAt || session.lastMessageAt;
      if (ts) {
        const lastMsg = new Date(ts);
        if (!agents[agentId].lastActivity || lastMsg > agents[agentId].lastActivity) {
          agents[agentId].lastActivity = lastMsg;
        }
      }
    }

    return {
      agents: Object.values(agents),
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.active).length,
    };
  } catch (error) {
    console.error('Failed to get agent metrics:', error);
    return { agents: [], totalSessions: 0, activeSessions: 0 };
  }
}

/**
 * Get cron job reliability metrics from RPC data
 */
export function getCronMetrics(cronJobs) {
  const jobs = cronJobs.map(job => {
    // Support both raw RPC format and pre-processed /api/cron format
    const enabled = job.enabled ?? true;
    const lastStatus = job.lastStatus || job.state?.lastStatus || 'never';
    const lastRunAt = job.lastRunAt || (job.state?.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null);
    const lastDurationMs = job.lastDurationMs || job.state?.lastDurationMs || 0;
    const consecutiveErrors = job.consecutiveErrors || job.state?.consecutiveErrors || 0;

    return {
      id: job.id,
      name: job.name,
      agentId: job.agentId,
      enabled,
      schedule: job.schedule?.expr || job.schedule,
      lastStatus,
      lastRunAt,
      lastDurationMs,
      consecutiveErrors,
      // Compute uptime: if last status is ok, count as up
      uptime: lastStatus === 'ok' ? 1 : lastStatus === 'error' ? 0 : 1,
    };
  });

  const enabledJobs = jobs.filter(j => j.enabled);
  const jobsWithRuns = enabledJobs.filter(j => j.lastStatus !== 'never');
  const totalUptime = jobsWithRuns.length > 0
    ? jobsWithRuns.reduce((sum, j) => sum + j.uptime, 0) / jobsWithRuns.length
    : 0;

  return {
    jobs,
    summary: {
      total: jobs.length,
      enabled: enabledJobs.length,
      avgUptime: totalUptime,
      recentFailures: jobs.filter(j => j.lastStatus === 'error').length,
    },
  };
}

/**
 * Get system resource metrics
 */
export async function getSystemMetrics(gatewayHealth) {
  // gatewayHealth is the result of rpcCall('health') wrapped as { status: 'ok', gateway: result }
  const gateway = gatewayHealth?.gateway || gatewayHealth || {};
  const status = gatewayHealth?.status || (gateway.ok ? 'ok' : 'unknown');
  // Gateway health doesn't report uptime directly; compute from dashboard uptime as proxy
  const uptime = gateway.uptime || (gateway.uptimeMs ? gateway.uptimeMs / 1000 : 0);
  const activeSessions = gateway.sessions?.active || gateway.sessions?.count || 0;

  return {
    gateway: {
      status,
      uptime,
      sessions: { active: activeSessions },
      version: gateway.version || process.env.npm_package_version || 'unknown',
    },
    dashboard: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        rss: process.memoryUsage().rss,
      },
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get combined metrics summary — fetches cron and health data via RPC
 */
export async function getMetricsSummary(rpcCall, _cronJobs, _gatewayHealth) {
  // Fetch all data fresh via RPC rather than relying on cached app state
  const [agentMetrics, cronResult, healthResult] = await Promise.all([
    getAgentMetrics(rpcCall),
    rpcCall('cron.list', { includeDisabled: true }).catch(() => ({ jobs: [] })),
    rpcCall('health').catch(() => null),
  ]);

  // Process cron jobs from raw RPC response
  const cronJobs = (cronResult?.jobs || []).map(j => ({
    id: j.id,
    name: j.name,
    agentId: j.agentId,
    enabled: j.enabled,
    schedule: j.schedule,
    state: j.state,
    lastStatus: j.state?.lastStatus || 'never',
    lastRunAt: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
    lastDurationMs: j.state?.lastDurationMs || null,
    consecutiveErrors: j.state?.consecutiveErrors || 0,
  }));

  const cronMetrics = getCronMetrics(cronJobs);
  const systemMetrics = await getSystemMetrics(
    healthResult ? { status: 'ok', gateway: healthResult } : {}
  );

  return {
    agents: agentMetrics,
    cron: cronMetrics,
    system: systemMetrics,
    timestamp: new Date().toISOString(),
  };
}
