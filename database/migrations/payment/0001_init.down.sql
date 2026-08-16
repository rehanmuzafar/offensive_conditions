-- Payment schema rollback
DROP TABLE IF EXISTS payment.webhook_events CASCADE;
DROP TABLE IF EXISTS payment.coupon_redemptions CASCADE;
DROP TABLE IF EXISTS payment.coupons CASCADE;
DROP TABLE IF EXISTS payment.transactions_2026_07 CASCADE;
DROP TABLE IF EXISTS payment.transactions_2026_06 CASCADE;
DROP TABLE IF EXISTS payment.transactions_2026_05 CASCADE;
DROP TABLE IF EXISTS payment.transactions CASCADE;
DROP TABLE IF EXISTS payment.invoices CASCADE;
DROP TABLE IF EXISTS payment.subscriptions CASCADE;
DROP TABLE IF EXISTS payment.payment_methods CASCADE;
DROP TABLE IF EXISTS payment.customers CASCADE;
DROP TABLE IF EXISTS payment.plans CASCADE;
