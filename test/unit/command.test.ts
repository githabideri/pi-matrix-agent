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

  // Model switch command tests
  it("parses !model as command_model_status", () => {
    expect(parseCommand("!model")).toEqual({ kind: "command_model_status" });
  });

  it("parses !model --status as command_model_status", () => {
    expect(parseCommand("!model --status")).toEqual({ kind: "command_model_status" });
  });

  it("parses !model qwen36 as command_model_switch", () => {
    expect(parseCommand("!model qwen36")).toEqual({
      kind: "command_model_switch",
      profile: "qwen36",
    });
  });

  it("parses !model qwen27 as command_model_switch", () => {
    expect(parseCommand("!model qwen27")).toEqual({
      kind: "command_model_switch",
      profile: "qwen27",
    });
  });

  it("parses !m q36 as command_model_switch with canonicalized profile", () => {
    expect(parseCommand("!m q36")).toEqual({
      kind: "command_model_switch",
      profile: "qwen36", // q36 is canonicalized to qwen36
    });
  });

  it("parses !m q27 as command_model_switch with canonicalized profile", () => {
    expect(parseCommand("!m q27")).toEqual({
      kind: "command_model_switch",
      profile: "qwen27", // q27 is canonicalized to qwen27
    });
  });

  it("parses !model with uppercase as command_model_switch (normalized)", () => {
    expect(parseCommand("!model QWEN36")).toEqual({
      kind: "command_model_switch",
      profile: "qwen36", // QWEN36 is normalized to lowercase
    });
  });

  it("parses !m with uppercase as command_model_switch with canonicalized profile", () => {
    expect(parseCommand("!M Q27")).toEqual({
      kind: "command_model_switch",
      profile: "qwen27", // Q27 is canonicalized to qwen27
    });
  });

  it("parses invalid profile as command_model_switch (validation happens later)", () => {
    expect(parseCommand("!model invalidprofile")).toEqual({
      kind: "command_model_switch",
      profile: "invalidprofile",
    });
  });

  it("treats !model with extra args as chat_prompt (malformed)", () => {
    // "!model qwen36 qwen27" is malformed - should not silently parse
    expect(parseCommand("!model qwen36 qwen27")).toEqual({ kind: "command_help" });
  });

  it("treats !m --status as command_model_status", () => {
    expect(parseCommand("!m --status")).toEqual({ kind: "command_model_status" });
  });

  // Phase 2: Clear command tests
  it("parses !model --clear as command_model_clear", () => {
    expect(parseCommand("!model --clear")).toEqual({ kind: "command_model_clear" });
  });

  it("parses !m --clear as command_model_clear", () => {
    expect(parseCommand("!m --clear")).toEqual({ kind: "command_model_clear" });
  });

  it("parses !m -c as command_model_clear", () => {
    expect(parseCommand("!m -c")).toEqual({ kind: "command_model_clear" });
  });

  it("parses !m -s as command_model_status", () => {
    expect(parseCommand("!m -s")).toEqual({ kind: "command_model_status" });
  });
});
