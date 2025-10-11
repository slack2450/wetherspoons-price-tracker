import { WetherspoonsZonalAPI } from './apis/zonal';
import { Product } from './product';

interface VenueProps {
  zonalId: number;
  salesArea: number;
}

export class Venue {
  zonalId: number;
  salesArea: number;

  constructor({ zonalId, salesArea }: VenueProps) {
    this.zonalId = zonalId;
    this.salesArea = salesArea;
  }

  async getDrinks({ showOutOfStock = false }: { showOutOfStock: boolean }): Promise<Map<number, Product>> {
    const menus = await WetherspoonsZonalAPI.getMenus({
      siteId: this.zonalId,
      salesAreaId: this.salesArea
    });

    const products = new Map<number, Product>();

    for (const menu of menus.menus) {
      const menuPages = await WetherspoonsZonalAPI.getMenuPages({
        siteId: this.zonalId,
        salesAreaId: this.salesArea,
        menuId: menu.id
      })

      for (const item of menuPages.aztec.products) {
        if (!showOutOfStock && item.isOutOfStock === 1) {
          continue;
        }

        products.set(
          item.id,
          new Product({
            id: item.id,
            eposName: item.eposName,
          })
        )
      }
    }

    return products;
  }
}
