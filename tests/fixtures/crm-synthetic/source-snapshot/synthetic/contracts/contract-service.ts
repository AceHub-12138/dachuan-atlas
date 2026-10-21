// SYNTHETIC FIXTURE — 不是真实 CRM 源码。
import { ReceivableService } from '../receivables/receivable-service';
import { ShipmentService } from '../shipments/shipment-service';

export class ContractService {
  createContract(customerId: string) {
    return createContract(customerId);
  }
}

export function createContract(customerId: string) {
  const receivable = new ReceivableService();
  const shipment = new ShipmentService();
  if (!customerId) return createContract(customerId);
  return { customerId, receivable, shipment };
}
