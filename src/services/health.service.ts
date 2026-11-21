export function getHealthStatus() {
  return {
    service: "girlboss-backend",
    status: "healthy",
  } as const;
}
