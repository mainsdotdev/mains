import { stripVTControlCharacters } from "node:util";
import { githubPullRequestUrl, pullRequestRefFromUrl } from "@mains/contracts/pull-requests";
import type { WorkRunToolCallEvent } from "../../../shared/adapter.types";

/** Small, conservative lexer: words, quotes and command boundaries, never shell execution. */
function shellCommands(command: string): string[][] | null {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  const flushWord = () => { if (started) words.push(word); word = ""; started = false; };
  const flushCommand = () => { flushWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && quote !== "'") {
      const next = command[++i];
      if (next === undefined) return null;
      if (next !== "\n") { word += next; started = true; }
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char; started = true;
    } else if (char === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (char === ";" || char === "\n") {
      flushCommand();
    } else if (char === "&" && command[i + 1] === "&") {
      flushCommand(); i++;
    } else if ("|&()<>`".includes(char)) {
      // Pipelines, fallbacks, background launches, substitutions and heredocs
      // cannot reliably attribute their combined output to one PR creation.
      return null;
    } else if (/\s/.test(char)) {
      flushWord();
    } else {
      word += char; started = true;
    }
  }
  if (quote) return null;
  flushCommand();
  return commands;
}

function isCreateCommand(command: string, depth = 0): boolean {
  if (command.length > 64_000 || depth > 2) return false;
  const commands = shellCommands(command);
  const words = commands?.at(-1)?.slice();
  if (!words) return false;
  while (words[0] && /^[A-Za-z_][\w]*=/.test(words[0])) words.shift();
  if (words[0] === "env") {
    words.shift();
    while (words[0] && (/^[A-Za-z_][\w]*=/.test(words[0]) || ["-i", "--ignore-environment"].includes(words[0]))) words.shift();
  }
  const executable = words.shift()?.split(/[\\/]/).at(-1)?.toLowerCase();
  if (executable && ["sh", "bash", "zsh"].includes(executable)) {
    return words.length === 2 && /^-[a-z]*c[a-z]*$/.test(words[0]) && isCreateCommand(words[1], depth + 1);
  }
  if (executable !== "gh" && executable !== "gh.exe") return false;
  while (words[0]?.startsWith("-")) {
    if (["-R", "--repo", "--hostname"].includes(words[0])) {
      if (!words[1]) return false;
      words.splice(0, 2);
    } else if (/^--(?:repo|hostname)=.+/.test(words[0])) words.shift();
    else return false;
  }
  return words[0] === "pr" && words[1] === "create" &&
    !words.slice(2).some((word) => ["--help", "-h", "--dry-run", "--web"].includes(word));
}

export function pullRequestCreationCommand(event: WorkRunToolCallEvent): string | null {
  if (!["bash", "shell", "exec_command", "functions.exec_command"].includes(event.toolName.toLowerCase())) return null;
  const command = event.input?.command ?? event.input?.cmd;
  return typeof command === "string" && isCreateCommand(command) ? command : null;
}

function outputText(output: unknown, depth = 0): string {
  if (typeof output === "string") return output.slice(-64_000);
  if (!output || typeof output !== "object" || depth > 2) return "";
  if (Array.isArray(output)) return output.slice(-16).map((block) => outputText(block, depth + 1)).join("\n");
  const record = output as Record<string, unknown>;
  return outputText(record.stdout ?? record.output ?? record.content ?? record.text, depth + 1);
}

/** Only a completed tool's actual output can announce a PR; assistant prose cannot. */
export function createdPullRequestUrl(event: WorkRunToolCallEvent): string | null {
  if (event.metadata?.phase !== "end" && event.metadata?.phase !== "complete") return null;
  if (event.error || (event.terminalStatus ?? "done") !== "done" ||
      event.metadata?.success === false || event.metadata?.interrupted === true) return null;
  const result = event.output && typeof event.output === "object" ? event.output as Record<string, unknown> : undefined;
  if (result?.interrupted === true || result?.isError === true || result?.is_error === true || result?.success === false || result?.error) return null;
  const exitCodes = [event.metadata?.exitCode, event.metadata?.exit_code, result?.exitCode, result?.exit_code];
  if (exitCodes.some((code) => code !== undefined && code !== null && code !== 0)) return null;
  const urls = new Set<string>();
  for (const line of stripVTControlCharacters(outputText(event.output)).split(/\r?\n/)) {
    const ref = pullRequestRefFromUrl(line.trim());
    if (ref) urls.add(githubPullRequestUrl(ref));
  }
  return urls.size === 1 ? [...urls][0] : null;
}
