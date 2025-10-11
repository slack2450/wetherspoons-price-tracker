import { z } from "zod";

export namespace WetherspoonsAPI {
    const API_ENDPOINT = 'https://ca.jdw-apps.net/api/v0.1';
    const API_HEADERS = {
        Authorization: "Bearer 1|SFS9MMnn5deflq0BMcUTSijwSMBB4mc7NSG2rOhqb2765466"
    };

    async function request(path: string): Promise<any> {
        const response = await fetch(`${API_ENDPOINT}${path}`,
            {
                headers: API_HEADERS
            }
        )
        const json = await response.json();
        return json;
    }

    export const highLevelVenueSchema = z.object({
        franchise: z.string(),
        id: z.number(),
        isClosed: z.boolean(),
        name: z.string(),
        venueRef: z.number()
    })
    export type HighLevelVenue = z.infer<typeof highLevelVenueSchema>;

    export async function venues(): Promise<HighLevelVenue[]> {
        const response = await request('/venues');
        const venues = z.object({ data: z.array(highLevelVenueSchema) }).parse(response);
        return venues.data;
    }

    const detailedVenueSchema = z.object({
        canPlaceOrder: z.boolean(),
        franchise: z.string(),
        id: z.number(),
        isClosed: z.boolean().optional(),
        name: z.string(),
        salesAreas: z.array(z.object({
            id: z.number(),
        })),
        venueCanOrder: z.boolean(),
        venueRef: z.union([z.string(), z.number()])
    });
    export type DetailedVenue = z.infer<typeof detailedVenueSchema>;

    export async function getVenue(venue: HighLevelVenue): Promise<DetailedVenue> {
        const response = await request(`/venues/${venue.venueRef}`);
        const venueDetails = z.object({ data: detailedVenueSchema }).parse(response);
        return venueDetails.data;
    }

    export const highLevelMenuSchema = z.object({
        canOrder: z.boolean(),
        franchise: z.string(),
        id: z.number(),
        name: z.string(),
        salesAreaId: z.number(),
        venueRef: z.number(),
    });
    export type HighLevelMenu = z.infer<typeof highLevelMenuSchema>;

    export async function getMenus({ venue, salesAreaId }: { venue: DetailedVenue, salesAreaId: number }): Promise<HighLevelMenu[]> {
        const response = await request(`/${venue.franchise}/venues/${venue.venueRef}/sales-areas/${salesAreaId}/menus`);
        const menus = z.object({ data: z.array(highLevelMenuSchema) }).parse(response);
        return menus.data;
    }

    const detailedMenuProductSchema = z.object({
        id: z.number(),
        isOutOfStock: z.boolean(),
        itemType: z.literal("product"),
        name: z.string(),
        description: z.string(),
        options: z.object({
            portion: z.object({
                options: z.array(z.object({
                    label: z.string(),
                    value: z.object({
                        price: z.object({
                            currency: z.string(),
                            discount: z.number(),
                            initialValue: z.number(),
                            value: z.number(),
                        })
                    })
                }))
            }),
        }),
    });
    export type DetailedMenuProduct = z.infer<typeof detailedMenuProductSchema>;

    const detailedMenuSchema = z.object({
        data: z.object({
            canOrder: z.boolean(),
            categories: z.array(z.object({
                itemGroups: z.array(z.object({
                    items: z.array(z.union([
                        z.object({
                            itemType: z.literal("text"),
                            text: z.string(),
                        }),
                        z.object({
                            itemType: z.literal("divider"),
                        }),
                        z.object({
                            itemType: z.literal("ale"),
                        }),
                        detailedMenuProductSchema
                    ])),
                    name: z.string().nullable(),
                })),
                name: z.string(),
            })),
            franchise: z.string(),
            id: z.number(),
            salesAreaId: z.number(),
            venueRef: z.number(),
        })
    });
    export type DetailedMenu = z.infer<typeof detailedMenuSchema>;

    export async function getMenu(highLevelMenu: HighLevelMenu): Promise<DetailedMenu> {
        const response = await request(`/${highLevelMenu.franchise}/venues/${highLevelMenu.venueRef}/sales-areas/${highLevelMenu.salesAreaId}/menus/${highLevelMenu.id}`);
        const detailedMenu = detailedMenuSchema.parse(response);;
        return detailedMenu;
    }
}