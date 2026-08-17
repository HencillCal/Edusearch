import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const logFile = path.join(process.cwd(), "git_push_log.txt");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try {
    fs.appendFileSync(logFile, line);
  } catch (e) {
    console.error("Failed writing log line", e);
  }
}

function run(cmd) {
  log(`> Executing: ${cmd}`);
  try {
    const out = execSync(cmd, {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }
    });
    log(`OUTPUT:\n${out}`);
    return { ok: true, out };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    log(`ERROR:\n${stderr}`);
    return { ok: false, err: err.message, stderr };
  }
}

async function main() {
  log("Starting Git Repository Setup and Push to https://github.com/HencillCal/Edusearch.git ...");

  if (!fs.existsSync(path.join(process.cwd(), ".git"))) {
    log(".git directory not found. Initializing git repo...");
    run("git init");
    run("git branch -M main");
  } else {
    log(".git directory already exists.");
  }

  // Configure remote
  const remoteCheck = run("git remote get-url origin");
  if (remoteCheck.ok) {
    log("Setting origin remote URL...");
    run("git remote set-url origin https://github.com/HencillCal/Edusearch.git");
  } else {
    log("Adding origin remote...");
    run("git remote add origin https://github.com/HencillCal/Edusearch.git");
  }

  // Stage files
  log("Staging project files...");
  run("git add .");

  // Commit if changes exist
  log("Checking status before commit...");
  const statusRes = run("git status --porcelain");
  if (statusRes.ok && statusRes.out.trim().length > 0) {
    log("Committing changes...");
    run('git commit -m "Deploy EduSearch AI Production V13"');
  } else {
    log("No changes to commit or repo already committed.");
  }

  // Push to remote
  log("Pushing to remote origin main...");
  let pushRes = run("git push -u origin main");
  if (!pushRes.ok) {
    log("Push to main returned error. Retrying with git push -u origin master...");
    pushRes = run("git push -u origin master");
  }

  log("Git operation script finished.");
}

main();
