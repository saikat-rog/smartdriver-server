import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { db } from '../db.js';

const envVar = (process.env.CASHFREE_ENVIRONMENT || '').trim().toUpperCase();
const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();

// Auto-detect production: explicitly set to PRODUCTION or using production-prefixed keys
const isProduction = envVar === 'PRODUCTION' || secretKey.startsWith('cfsk_ma_prod_') || appId.startsWith('152');

if (!appId || !secretKey) {
  console.warn('⚠️ CASHFREE_APP_ID or CASHFREE_SECRET_KEY is missing from environment variables.');
}

export const cashfree = new Cashfree(
  isProduction ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  appId,
  secretKey
);

export type PaymentOrderType = 'registration_fee' | 'subscription';

export interface CreateOrderParams {
  driverId: number;
  phone: string;
  name?: string;
  email?: string;
  orderType: PaymentOrderType;
  returnUrl?: string;
}

export async function createCashfreeOrder(params: CreateOrderParams) {
  const { driverId, phone, name, email, orderType, returnUrl } = params;

  if (!appId || !secretKey) {
    throw new Error('Cashfree credentials (CASHFREE_APP_ID / CASHFREE_SECRET_KEY) are missing in the server .env file.');
  }

  // Strict server-side amount enforcement to prevent tampering
  const orderAmount = orderType === 'registration_fee' ? 3000.0 : 2000.0;
  const prefix = orderType === 'registration_fee' ? 'FEE' : 'SUB';
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

  if (cleanPhone.length !== 10) {
    throw new Error('A valid 10-digit mobile number is required to initiate payment.');
  }

  // Max 45 characters, alphanumeric + underscores
  const orderId = `SD_${prefix}_${driverId}_${Date.now()}`;

  const request = {
    order_id: orderId,
    order_amount: orderAmount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `driver_${driverId}`,
      customer_phone: cleanPhone,
      customer_name: (name && name.trim()) || 'Driver Partner',
      ...(email && email.trim() ? { customer_email: email.trim() } : {}),
    },
    order_meta: {
      ...(returnUrl ? { return_url: returnUrl } : {}),
      notify_url: process.env.CASHFREE_WEBHOOK_URL || undefined,
    },
    order_note: orderType === 'registration_fee'
      ? 'Smart Driver Partner One-Time Registration & Verification Fee'
      : 'Smart Driver Platform Subscription Fee',
  };

  const response = await cashfree.PGCreateOrder(request);
  const data = response.data;

  if (!data || !data.payment_session_id) {
    throw new Error('Cashfree did not return a valid payment_session_id.');
  }

  // Insert payment record into local database
  const insertPayment = db.prepare(`
    INSERT INTO payments (
      order_id, driver_id, order_type, order_amount, order_currency,
      payment_session_id, order_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
  `);

  insertPayment.run(
    orderId,
    driverId,
    orderType,
    orderAmount,
    'INR',
    data.payment_session_id
  );

  return {
    order_id: orderId,
    payment_session_id: data.payment_session_id,
    order_amount: orderAmount,
    order_currency: 'INR',
    order_status: data.order_status || 'ACTIVE',
  };
}

export async function verifyAndSettleOrder(orderId: string) {
  // 1. Fetch payment record from database
  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as any;
  if (!payment) {
    throw new Error(`Order ${orderId} not found in database.`);
  }

  // 2. Fetch authoritative order state directly from Cashfree API
  const orderResponse = await cashfree.PGFetchOrder(orderId);
  const orderData = orderResponse.data;
  const status = orderData.order_status; // PAID, ACTIVE, EXPIRED, TERMINATED

  let cfPaymentId: string | null = null;
  let paymentMethod: string | null = null;
  let paymentTime: string | null = null;

  if (status === 'PAID') {
    try {
      const paymentsResponse = await cashfree.PGOrderFetchPayments(orderId);
      const paymentsList = paymentsResponse.data;
      if (Array.isArray(paymentsList) && paymentsList.length > 0) {
        // Find successful payment
        const successful = paymentsList.find((p: any) => p.payment_status === 'SUCCESS') || paymentsList[0];
        if (successful) {
          cfPaymentId = successful.cf_payment_id ? String(successful.cf_payment_id) : null;
          paymentMethod = typeof successful.payment_group === 'string'
            ? successful.payment_group
            : (typeof successful.payment_method === 'string' ? successful.payment_method : 'CASHFREE');
          paymentTime = successful.payment_completion_time || new Date().toISOString();
        }
      }
    } catch (fetchErr) {
      console.warn('Could not fetch individual payment details for order:', orderId, fetchErr);
    }

    const effectiveTxId = cfPaymentId || orderId;

    // Update payment record
    db.prepare(`
      UPDATE payments
      SET order_status = 'PAID',
          cf_payment_id = ?,
          payment_method = ?,
          payment_time = ?,
          updated_at = datetime('now')
      WHERE order_id = ?
    `).run(effectiveTxId, paymentMethod, paymentTime || new Date().toISOString(), orderId);

    // Update Driver record idempotently
    if (payment.order_type === 'registration_fee') {
      db.prepare(`
        UPDATE drivers
        SET fee_paid = 1,
            fee_amount = ?,
            fee_tx_id = ?,
            fee_paid_at = COALESCE(fee_paid_at, datetime('now')),
            current_step = MAX(COALESCE(current_step, 1), 5),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(payment.order_amount, effectiveTxId, payment.driver_id);
    } else if (payment.order_type === 'subscription') {
      db.prepare(`
        UPDATE drivers
        SET subscription_paid = 1,
            subscription_amount = ?,
            subscription_tx_id = ?,
            subscription_paid_at = COALESCE(subscription_paid_at, datetime('now')),
            current_step = MAX(COALESCE(current_step, 1), 6),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(payment.order_amount, effectiveTxId, payment.driver_id);
    }
  } else if (status === 'EXPIRED' || status === 'TERMINATED') {
    db.prepare(`
      UPDATE payments
      SET order_status = ?,
          updated_at = datetime('now')
      WHERE order_id = ?
    `).run(status, orderId);
  }

  // Fetch updated driver
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(payment.driver_id);

  return {
    order_id: orderId,
    order_status: status,
    is_paid: status === 'PAID',
    payment_type: payment.order_type,
    amount: payment.order_amount,
    driver,
  };
}

export function verifyWebhookSignature(signature: string, rawBody: string, timestamp: string): boolean {
  try {
    cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
    return true;
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return false;
  }
}
