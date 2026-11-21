import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
  Subheading,
} from "./page.tsx";

const meta = {
  title: "Components/Page",
  component: Page,
  tags: ["page"],
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithATitle: Story = {
  render: () => (
    <Page>
      <PageTitle>Overview</PageTitle>
    </Page>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
  },
};

export const OnAPhone: Story = {
  ...WithATitle,
  globals: { viewport: { value: "mobile2" } },
};

/**
 * Stale content is dimmed for the moment a new answer takes to replace it, as
 * an inactive part of the page, which WCAG 1.4.3 exempts from contrast; the
 * rule still checks everything else.
 */
const staleContrast = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", selector: ":not([data-stale] *)" }],
    },
  },
};

export const WithSections: Story = {
  render: () => (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Pools</PageTitle>
          <PageDescription>3 pools · 2 with quota windows</PageDescription>
        </div>
      </PageHeader>
      <Section aria-labelledby="traffic">
        <SectionHeader>
          <div>
            <SectionTitle id="traffic">Traffic</SectionTitle>
            <SectionDescription>All pools · last 24 hours</SectionDescription>
          </div>
        </SectionHeader>
        <Subheading>Where the tokens went</Subheading>
      </Section>
      <Section aria-labelledby="stale" stale>
        <SectionHeader>
          <SectionTitle id="stale">Projects and models</SectionTitle>
        </SectionHeader>
      </Section>
    </Page>
  ),
  parameters: staleContrast,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("region", { name: "Projects and models" }),
    ).toHaveAttribute("aria-busy", "true");
  },
};
