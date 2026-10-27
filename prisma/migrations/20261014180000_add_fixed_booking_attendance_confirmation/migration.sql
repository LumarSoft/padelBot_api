-- Automatic attendance check for the fijos (turnos fijos).
--
-- The front desk's heaviest daily chore is calling every fixed booking to ask "¿venís?". The
-- bot now sends a WhatsApp template with two buttons instead: "No puedo" frees only that date
-- (the RecurringBooking stays) and the waitlist is offered the court; no answer never cancels.

-- AlterTable: per-club switch (off until the Meta template is approved) and how early to ask.
ALTER TABLE `Club` ADD COLUMN `fixedConfirmationEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `fixedConfirmationLeadHours` INTEGER NOT NULL DEFAULT 24;

-- AlterTable: when it was asked, the answer (yes / no / null) and when it came, plus the guard
-- for the "este fijo no respondió" push to the staff.
ALTER TABLE `Booking` ADD COLUMN `attendanceAskedAt` DATETIME(3) NULL,
    ADD COLUMN `attendanceConfirmed` BOOLEAN NULL,
    ADD COLUMN `attendanceAnsweredAt` DATETIME(3) NULL,
    ADD COLUMN `attendanceAlertSentAt` DATETIME(3) NULL;

-- CreateIndex: the sweeps read CONFIRMED bookings by whether they were asked.
CREATE INDEX `Booking_status_attendanceAskedAt_idx` ON `Booking`(`status`, `attendanceAskedAt`);
