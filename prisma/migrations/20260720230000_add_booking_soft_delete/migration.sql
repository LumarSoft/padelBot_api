-- Soft-delete for bookings.
--
-- A CANCELLED reservation can be removed from the club's lists (mobile/panel) without losing
-- the historical row: audit trails and stats keep the record. `deletedAt` null means live;
-- read paths filter `deletedAt IS NULL`. Only CANCELLED bookings are ever soft-deleted.

-- AlterTable
ALTER TABLE `Booking`
    ADD COLUMN `deletedAt` DATETIME(3) NULL;
