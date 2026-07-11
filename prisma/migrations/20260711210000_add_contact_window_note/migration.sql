-- AlterTable: the free-text window a prospect names when they pick "un horario puntual"
-- instead of a broad morning/afternoon/evening slot.
ALTER TABLE `ClubSignupRequest` ADD COLUMN `contactWindowNote` VARCHAR(191) NULL;
