module.exports = {
  apps: [
    {
      name: "edusearch",
      script: ".output/server/index.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 5173,
        HOST: "0.0.0.0",
      },
      autorestart: true,
      max_memory_restart: "1G",
    },
  ],
};
