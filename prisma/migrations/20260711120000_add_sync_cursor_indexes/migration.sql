-- Cursor-based online-to-local sync filters these tables by "updatedAt".
-- Additive indexes keep each incremental pull bounded as production data grows.
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");
CREATE INDEX "Sanction_updatedAt_idx" ON "Sanction"("updatedAt");
CREATE INDEX "CustomerProfile_updatedAt_idx" ON "CustomerProfile"("updatedAt");
CREATE INDEX "Category_updatedAt_idx" ON "Category"("updatedAt");
CREATE INDEX "Service_updatedAt_idx" ON "Service"("updatedAt");
CREATE INDEX "ServicePlace_updatedAt_idx" ON "ServicePlace"("updatedAt");
CREATE INDEX "PriceRule_updatedAt_idx" ON "PriceRule"("updatedAt");
CREATE INDEX "Booking_updatedAt_idx" ON "Booking"("updatedAt");
CREATE INDEX "Review_updatedAt_idx" ON "Review"("updatedAt");
CREATE INDEX "CancellationRequest_updatedAt_idx" ON "CancellationRequest"("updatedAt");
CREATE INDEX "BookingUnit_updatedAt_idx" ON "BookingUnit"("updatedAt");
CREATE INDEX "GuestIdDocument_updatedAt_idx" ON "GuestIdDocument"("updatedAt");
CREATE INDEX "Invoice_updatedAt_idx" ON "Invoice"("updatedAt");
CREATE INDEX "Payment_updatedAt_idx" ON "Payment"("updatedAt");
CREATE INDEX "Settings_updatedAt_idx" ON "Settings"("updatedAt");
CREATE INDEX "PromoCode_updatedAt_idx" ON "PromoCode"("updatedAt");
CREATE INDEX "RoleDiscountLimit_updatedAt_idx" ON "RoleDiscountLimit"("updatedAt");
CREATE INDEX "VisitCode_updatedAt_idx" ON "VisitCode"("updatedAt");
