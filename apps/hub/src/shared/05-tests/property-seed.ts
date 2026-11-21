import { Arbitrary } from "effect";

// Without a seed every run of a property draws its own cases. The mutant gate
// names one, so that the property that kills a mutant kills it in every run.
const seed = process.env.COTA_PROPERTY_SEED;
if (seed !== undefined) Arbitrary.configureGlobal({ check: { seed } });
