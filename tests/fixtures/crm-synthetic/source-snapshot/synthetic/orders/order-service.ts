// SYNTHETIC FIXTURE — 不是真实 CRM 源码。
import { createContract } from '../contracts/contract-service';
import { ShipmentService } from '../shipments/shipment-service';

export class OrderService {
  createOrder(customerId: string) {
    return createOrder(customerId);
  }
}

export function createOrder(customerId: string) {
  const contract = createContract(customerId);
  const shipment = new ShipmentService();
  return { customerId, contract, shipment };
}
