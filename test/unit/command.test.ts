import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/command.js";

describe("parseCommand", () => {
  it("treats plain text as chat_prompt", () => {
    expect(parseCommand("hello there")).toEqual({
      kind: "chat_prompt",
      prompt: "hello there",
    });
  });

  it("treats question as chat_prompt", () => {
    expect(parseCommand("what is the capital of France?")).toEqual({
      kind: "chat_prompt",
      prompt: "what is the capital of France?",
    });
  });

  it("parses !status as command_status", () => {
    expect(parseCommand("!status")).toEqual({ kind: "command_status" });
  });

  it("parses !ping as command_ping", () => {
    expect(parseCommand("!ping")).toEqual({ kind: "command_ping" });
  });

  it("parses !reset as command_reset", () => {
    expect(parseCommand("!reset")).toEqual({ kind: "command_reset" });
  });

  it("parses !help as command_help", () => {
    expect(parseCommand("!help")).toEqual({ kind: "command_help" });
  });

  it("parses !session as command_session", () => {
    expect(parseCommand("!session")).toEqual({ kind: "command_session" });
  });

  it("treats unknown !command as command_help", () => {
    expect(parseCommand("!unknown")).toEqual({ kind: "command_help" });
  });

  it("treats lone ! as command_help", () => {
    expect(parseCommand("!")).toEqual({ kind: "command_help" });
  });

  it("trims whitespace from chat_prompt", () => {
    expect(parseCommand("  hello world  ")).toEqual({
      kind: "chat_prompt",
      prompt: "hello world",
    });
  });
});
