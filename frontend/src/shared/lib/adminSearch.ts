/**
 * Unified search matching for the admin workspace: case-insensitive text, keyboard-layout
 * recovery, mixed Cyrillic/Latin look-alikes and Russian/Latin transliteration.
 */
export {
  normalizeProductSearchText as normalizeAdminSearchText,
  productMatchesSearch as adminMatchesSearch,
  productSearchVariants as adminSearchVariants,
} from "./productSearch";
