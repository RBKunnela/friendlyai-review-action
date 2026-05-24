import { appendFileSync } from "node:fs";
import { EOL } from "node:os";

interface InputOptions {
  required?: boolean;
}

export function getInput(name: string, options: InputOptions = {}): string {
  const key = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[key]?.trim() ?? "";
  if (options.required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

export function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}${EOL}`, { encoding: "utf8" });
    return;
  }
  issueCommand("set-output", { name }, value);
}

export function setFailed(message: string): void {
  process.exitCode = 1;
  error(message);
}

export function info(message: string): void {
  process.stdout.write(`${message}${EOL}`);
}

export function warning(message: string): void {
  issueCommand("warning", {}, message);
}

export function error(message: string): void {
  issueCommand("error", {}, message);
}

function issueCommand(
  command: string,
  properties: Record<string, string>,
  message: string,
): void {
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(",");
  const suffix = props ? ` ${props}` : "";
  process.stdout.write(`::${command}${suffix}::${escapeData(message)}${EOL}`);
}

function escapeData(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
