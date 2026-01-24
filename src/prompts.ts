// @ts-ignore
const { Select, Confirm, Input, MultiSelect } = require("enquirer");

// Suppress enquirer's readline error on Ctrl+C (Node.js 24+ issue)
process.on("uncaughtException", (err) => {
  if (err.message?.includes("readline was closed")) {
    console.log("\nCancelled");
    process.exit(0);
  }
  throw err;
});

function handleCancel(): never {
  console.log("\nCancelled");
  process.exit(0);
}

export async function promptConfirm(message: string): Promise<boolean> {
  try {
    const prompt = new Confirm({
      name: "confirm",
      message,
      format: (v: boolean) => v ? "Y" : "N",
    });
    return await prompt.run();
  } catch {
    handleCancel();
  }
}

export async function promptInput(message: string): Promise<string> {
  try {
    const prompt = new Input({ name: "input", message });
    return await prompt.run();
  } catch {
    handleCancel();
  }
}

export async function promptSelect(message: string, choices: string[]): Promise<string> {
  try {
    const prompt = new Select({ name: "select", message, choices });
    return await prompt.run();
  } catch {
    handleCancel();
  }
}

export async function promptMultiSelect(message: string, choices: string[]): Promise<string[]> {
  try {
    const prompt = new MultiSelect({
      name: "multiselect",
      message,
      choices: choices,
      initial: choices,
      indicator(state: any, choice: any) {
        return choice.enabled ? "●" : "○";
      },
    });
    return await prompt.run();
  } catch {
    handleCancel();
  }
}
