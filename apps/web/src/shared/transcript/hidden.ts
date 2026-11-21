import { Option, Schema } from "effect";
import { type Hideable, hideable } from "./transcript.tsx";

const decodeHidden = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Literals(hideable),
    Schema.Array(Schema.Literals(hideable)),
  ]),
);

/** What a `hide` parameter asks the toggles to hide, in the toggles' order; one that does not decode hides nothing. */
export const hiddenOf = (given: unknown): ReadonlyArray<Hideable> => {
  const hidden = Option.match(decodeHidden(given), {
    onNone: (): ReadonlyArray<Hideable> => [],
    onSome: (values) => (typeof values === "string" ? [values] : values),
  });
  return hideable.filter((each) => hidden.includes(each));
};

/** The search after a toggle is pressed, its `hide` left out when nothing is hidden. */
export const switched =
  (key: Hideable, hide: boolean) =>
  <S extends { readonly hide?: ReadonlyArray<Hideable> }>({
    hide: before,
    ...rest
  }: S): Omit<S, "hide"> & { hide?: ReadonlyArray<Hideable> } => {
    const after = hideable.filter((each) =>
      each === key ? hide : (before ?? []).includes(each),
    );
    return after.length === 0 ? rest : { ...rest, hide: after };
  };
