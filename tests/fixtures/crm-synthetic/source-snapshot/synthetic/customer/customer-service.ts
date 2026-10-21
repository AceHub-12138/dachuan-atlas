// SYNTHETIC FIXTURE — 不是真实 CRM 源码，仅用于 P2.0-A 导入管线测试。
import { makeId } from '../shared/id';
import { readConfig } from '../shared/config';
import { createOrder } from '../orders/order-service';

export class CustomerService {
  createCustomer(input: { name: string }) {
    const id = makeId('customer');
    const config = readConfig();
    if (!config.allowCreate) throw new Error('disabled');
    return { id, name: input.name };
  }
}

export function createCustomer(name: string) {
  const id = makeId('customer');
  const order = createOrder(id);
  return { id, name, order };
}
