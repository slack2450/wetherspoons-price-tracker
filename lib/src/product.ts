interface ProductProps {
  id: number;
  eposName: string;
}

export class Product {
  id: number;
  eposName: string;

  constructor({ id, eposName }: ProductProps) {
    this.id = id;
    this.eposName = eposName;
  }
}
