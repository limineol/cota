import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Field, FieldGroup, FieldNone, Fields } from "./fields.tsx";

const meta = {
  title: "Components/Fields",
  component: Fields,
} satisfies Meta<typeof Fields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoGroups: Story = {
  render: () => (
    <div className="@container">
      <Fields>
        <FieldGroup title="Where it went">
          <Field name="Pool">work</Field>
          <Field name="Provider">anthropic</Field>
          <Field name="Model asked for">claude-opus-4-5</Field>
          <Field name="Diverted from">
            <FieldNone>not diverted</FieldNone>
          </Field>
        </FieldGroup>
        <FieldGroup title="Quota headers">
          <Field name="anthropic-ratelimit-unified-5h-utilization">0.41</Field>
          <Field name="anthropic-ratelimit-unified-5h-reset">1763215200</Field>
        </FieldGroup>
      </Fields>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Model asked for")).toBeVisible();
    await expect(canvas.getByText("claude-opus-4-5")).toBeVisible();
  },
};
