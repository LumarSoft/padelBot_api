-- DropColumn: mpPreferenceId is dead (the MercadoPago checkout-link flow was removed;
-- deposits are reconciled by exact transfer amount, not by a preference id).
ALTER TABLE `Booking` DROP COLUMN `mpPreferenceId`;
