# Post-Implementation Review
1. Re-read the original user request
2. List each requirement and whether it was addressed
3. Grep for any variables that were removed or renamed to ensure no dangling references
4. Check that changes were applied to ALL relevant pages (not just the first one found)
5. Run `npx tsc --noEmit` and report any errors
