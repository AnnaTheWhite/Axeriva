-- "ReadyToConvert" is no longer a valid OwnerNote.status (the Convert
-- workflow it supported was removed from the product). OwnerNote.status is
-- a free-form string column, not a DB enum, so no schema change is needed
-- here — only a data fix for any rows still carrying the retired value.
UPDATE "OwnerNote" SET "status" = 'Reviewed' WHERE "status" = 'ReadyToConvert';
