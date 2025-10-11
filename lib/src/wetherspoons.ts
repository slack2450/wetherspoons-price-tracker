import { WetherspoonsAPI } from './apis/jdw-apps';
import { Drink } from './types/Drink';

function strengthAndVolumeToUnits(strength: number, volume: number) {
  return (strength * volume) / 1000;
}

export async function getTodaysDrinks(highLevelVenue: WetherspoonsAPI.HighLevelVenue): Promise<Drink[]> {

  const detailedVenue = await WetherspoonsAPI.getVenue(highLevelVenue);

  const salesArea = detailedVenue.salesAreas[0];

  const menus = await WetherspoonsAPI.getMenus({ venue: detailedVenue, salesAreaId: salesArea.id });

  let drinksMenu;
  for (const menu of menus) {
    if (menu.name === 'Drinks') {
      drinksMenu = menu;
      break;
    }
  }

  if (!drinksMenu) return [];
  const res = await WetherspoonsAPI.getMenu(drinksMenu);

  // Convert menu to flat array of drinks
  const hash_map = new Map<number, WetherspoonsAPI.DetailedMenuProduct>();

  for (const categories of res.data.categories) {
    for (const itemGroup of categories.itemGroups) {
      for (const item of itemGroup.items) {
        if (item.itemType == 'product') {
          // Skip out of stock
          if (item.isOutOfStock) continue;
          hash_map.set(item.id, item)
        }
      }
    }
  }

  const drinks: Drink[] = [];

  for (const product of hash_map.values()) {


    const strengthMatches = product.description.match(/(\d?\d?\.?\d?\d%)\s?ABV/);
    const volumeDescriptionMatches = product.description.match(/(\d?\d\d)ml/);

    let strength;
    if (strengthMatches)
      strength = parseFloat(strengthMatches[0])

    let volumeDescription;
    if (volumeDescriptionMatches)
      volumeDescription = parseFloat(volumeDescriptionMatches[0])

    let bestPortion;
    let bestPPU = Infinity;
    let bestUnits = 0;

    for (const portion of product.options.portion.options) {
      let units;

      const volumeMatches = portion.label.match(/(\d?\d\d)ml/);

      let volume;
      if (volumeMatches)
        volume = parseFloat(volumeMatches[1]);

      const unitsMatches = portion.label.match(/(\d?\.?\d?\d) unit/);
      if (unitsMatches)
        units = parseFloat(unitsMatches[1]);

      if (portion.label === 'Pint' && strength) {
        units = strengthAndVolumeToUnits(strength, 568);
      } else if (['Half pint', 'Half Pint', 'Half'].includes(portion.label) && typeof strength !== 'undefined') {
        units = strengthAndVolumeToUnits(strength, 284);
      } else if (typeof strength !== 'undefined' && volume) {
        units = strengthAndVolumeToUnits(strength, volume);
      } else if (typeof strength !== 'undefined' && volumeDescription) {
        units = strengthAndVolumeToUnits(strength, volumeDescription);
      } else if (typeof strength !== 'undefined' && portion.label === 'Single') {
        units = strengthAndVolumeToUnits(strength, 25)
      } else if (typeof strength !== 'undefined' && portion.label === 'Double') {
        units = strengthAndVolumeToUnits(strength, 50)
      }

      if (typeof units !== 'undefined') {
        const ppu = portion.value.price.value / units;

        if (ppu < bestPPU) {
          bestPPU = ppu;
          bestPortion = portion;
          bestUnits = units;
        }
      }
    }

    if (typeof bestPortion !== 'undefined') {
      drinks.push({
        name: product.name,
        units: bestUnits,
        ppu: bestPPU,
        productId: product.id,
        price: bestPortion?.value.price.value,
      })
    }
  }

  drinks.sort((a, b) => {
    return a.ppu - b.ppu;
  });

  return drinks;
}
