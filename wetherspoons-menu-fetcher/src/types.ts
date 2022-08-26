interface Drink {
    name: string;
    productId: number;
    price: number;
    units: number;
}

export interface Venue {
    venueId: number;
    date: number;
    drinks: Drink[];
}

interface Product {
    eposName: string;
    productId: number;
    description: string;
    priceValue: number;
}

interface ProductGroup {
    products: Product[];
}

interface SubMenu {
    productGroups: ProductGroup[];
}

export interface Menu {
    name: string;
    subMenu: SubMenu[]
}