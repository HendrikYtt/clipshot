// @ts-ignore
const { Select, Confirm, Input, MultiSelect } = require("enquirer");

export async function promptConfirm(message: string): Promise<boolean> {
  const prompt = new Confirm({ name: "confirm", message });
  return prompt.run();
}

export async function promptInput(message: string): Promise<string> {
  const prompt = new Input({ name: "input", message });
  return prompt.run();
}

export async function promptSelect(message: string, choices: string[]): Promise<string> {
  const prompt = new Select({ name: "select", message, choices });
  return prompt.run();
}

export async function promptMultiSelect(message: string, choices: string[]): Promise<string[]> {
  const prompt = new MultiSelect({
    name: "multiselect",
    message,
    choices: choices,
    initial: choices,
    hint: "(space to toggle, enter to confirm)",
    indicator(state: any, choice: any) {
      return choice.enabled ? "●" : "○";
    },
  });
  return prompt.run();
}
