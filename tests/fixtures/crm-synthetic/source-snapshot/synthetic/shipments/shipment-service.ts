// SYNTHETIC FIXTURE — 不是真实 CRM 源码。
import { z } from 'zod';

export const shipmentSchema = z.object({ customerId: z.string() });

export class ShipmentService {
  schedule(customerId: string) {
    return shipmentSchema.parse({ customerId });
  }
}
