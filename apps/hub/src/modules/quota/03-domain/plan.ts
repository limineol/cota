import { Option } from "effect";

/** A provider's id for a plan, its first character in upper case and the rest as given: `pro` is `Pro`. */
export const capitalised = (id: string): string => {
  const [first = "", ...rest] = id;
  return first.toUpperCase() + rest.join("");
};

const chatGptNames: ReadonlyMap<string, string> = new Map([
  ["pro", "Pro 20x"],
  ["prolite", "Pro 5x"],
  ["pro_lite", "Pro 5x"],
  ["free_workspace", "Free Workspace"],
]);

/** The name of a ChatGPT plan from its `plan_type`; none when it is empty. */
export const chatGpt = (planType: string): Option.Option<string> =>
  planType === ""
    ? Option.none()
    : Option.some(chatGptNames.get(planType) ?? capitalised(planType));

/**
 * The name of a Claude plan from the plan facts its login was made with: the
 * subscription capitalised, and for `max` only the multiple its rate limit
 * tier holds (`max` with `default_claude_max_20x` is `Max 20x`); none without
 * a subscription.
 */
export const claude = (
  subscriptionType: Option.Option<string>,
  rateLimitTier: Option.Option<string>,
): Option.Option<string> =>
  Option.map(subscriptionType, (type) => {
    const multiple =
      type === "max"
        ? Option.flatMap(rateLimitTier, (tier) =>
            Option.fromNullishOr(/max_(\d+)x/.exec(tier)?.[1]),
          )
        : Option.none();
    return Option.match(multiple, {
      onNone: () => capitalised(type),
      onSome: (times) => `${capitalised(type)} ${times}x`,
    });
  });
