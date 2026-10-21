/**
 * How many forget records a word keeps (`ProgressEntry.forgot`), newest last.
 *
 * It lives here and not in merge.ts because the writer that appends a record
 * and the merge that unions two devices' logs must cap at the same number, or
 * one of them would quietly keep what the other had just cut.
 */
export const FORGET_LOG_LIMIT = 10
