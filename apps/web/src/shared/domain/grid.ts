/** Where a grid of rows of one height is scrolled to, and how much of it shows. */
export interface View {
  /** How far the rows are scrolled, in pixels from the first row's top. */
  readonly top: number;
  /** How tall the view of the rows is, in pixels. */
  readonly height: number;
  readonly rowHeight: number;
  readonly rows: number;
  /** How many rows are drawn beyond the view on each side, so a scroll does not show a gap first. */
  readonly overscan: number;
}

/** The rows a grid draws, from `first` up to but not including `last`. */
export interface Drawn {
  readonly first: number;
  readonly last: number;
}

/**
 * The rows a virtualised grid draws: every row any part of which is in view,
 * and up to `overscan` rows more on each side, within the rows there are.
 */
export const drawnRows = ({
  top,
  height,
  rowHeight,
  rows,
  overscan,
}: View): Drawn => {
  const first = Math.min(
    rows,
    Math.max(0, Math.floor(top / rowHeight) - overscan),
  );
  const last = Math.max(
    first,
    Math.min(rows, Math.ceil((top + height) / rowHeight) + overscan),
  );
  return { first, last };
};
