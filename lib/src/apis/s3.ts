import { z } from "zod";

export class WetherspoonsS3API {
  static S3_API_ENDPOINT = 'https://oandp-appmgr-prod.s3.eu-west-2.amazonaws.com';

  static async request(endpoint: string): Promise<object> {
    const response = await fetch(`${this.S3_API_ENDPOINT}${endpoint}`);
    return await response.json()
  }

  static globalResponseSchema = z.object({
    venues: z.array(z.object({
      id: z.number(),
      identifier: z.number().nullable(),
      sitecore_id: z.string().nullable(),
      name: z.string(),
      address_line_1: z.string().nullable(),
      address_line_2: z.string().nullable(),
      town: z.string().nullable(),
      county: z.string().nullable(),
      post_code: z.string().nullable(),
      country_code: z.string().nullable(),
      country: z.string().nullable(),
      telephone: z.string().nullable(),
      latitude: z.string().nullable(),
      longitude: z.string().nullable(),
      email: z.string().nullable(),
      type: z.string(),
      is_closed: z.number(),
      related_site: z.unknown().nullable(), // TODO add the proper type
      payment: z.object({
        gateway: z.string().nullable(),
        bnpp: z.object({
          merchant_id: z.string(),
          apple_pay_merchant_id: z.string().optional(),
        }).optional(),
      }),
      payment_methods_disabled: z.array(z.string()),
      temporary_closed: z.union([
        z.object({
          closureTo: z.string(),
          closureFrom: z.string(),
          closureNotice: z.string(),
          pubIsTemporaryClosed: z.boolean(),
        }),
        z.array(z.never())
      ]),
    })
    ),
  })

  static async global(): Promise<z.infer<typeof this.globalResponseSchema>> {
    const response = await this.request('/global.json');
    const global = this.globalResponseSchema.parse(response);
    return global;
  }

  static newsResponseSchema = z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      created_at: z.string().datetime({ offset: true }),
      expires_at: z.string().datetime({ offset: true }),
      status: z.enum(["published"]),
      image_url: z.string().url(),
      compressed_image_url: z.string(),
      file_url: z.string().url(),
      locations: z.array(
        z.object({
          id: z.enum(["england", "scotland", "ni", "wales", "roi"]),
          label: z.enum([
            "England",
            "Scotland",
            "Northern Ireland",
            "Wales",
            "Republic of Ireland"
          ])
        })
      )
    })
  );

  static async news(): Promise<z.infer<typeof this.newsResponseSchema>> {
    const response = await this.request('/news.json');
    const news = this.newsResponseSchema.parse(response);
    return news;
  }

  static searchTermsResponseSchema = z.array(
    z.object({
      id: z.number(),
      products: z.array(
        z.object({
          entity_id: z.string(),
          name: z.string()
        })
      ),
      sort_order: z.number(),
      tags: z.array(z.string())
    })
  );

  static async searchTerms(): Promise<z.infer<typeof this.searchTermsResponseSchema>> {
    const response = await this.request('/search-terms.json');
    const searchTerms = this.searchTermsResponseSchema.parse(response);
    return searchTerms;
  }

  static recipesResponseSchema = z.array(
    z.record(
      z.string(),
      z.object({
        id: z.number(),
        product_id: z.string(),
        name: z.string(),
        max_items: z.number().nullable(),
        products: z.array(
          z.object({
            id: z.number(),
            product_id: z.number(),
            name: z.string(),
            free_text: z.string().nullable(),
            qty: z.number().nullable(),
            type: z.enum(["swap", "remove"]),
            calories: z.number().nullable()
          })
        )
      })
    )
  );

  static async recipes(): Promise<z.infer<typeof this.recipesResponseSchema>> {
    const response = await this.request('/recipes.json');
    const recipes = this.recipesResponseSchema.parse(response);
    return recipes;
  }

  static tillRequestsResponseSchema = z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      question: z.string(),
      options: z.array(z.string()),
      match_portion: z.array(z.string()),
      products: z.array(z.number()),
      required: z.union([z.literal(0), z.literal(1)]),
      single_choice: z.union([z.literal(0), z.literal(1)])
    })
  );

  static async tillRequests(): Promise<z.infer<typeof this.tillRequestsResponseSchema>> {
    const response = await this.request('/till-requests.json');
    const tillRequests = this.tillRequestsResponseSchema.parse(response);
    return tillRequests;
  }

  // Not really enough data for this API to be certain
  static productLevelPopupResponseSchema = z.record(
    z.string(),
    z.object({
      changed: z.union([
        z.literal(0),
        z.literal(1)
      ])
    })
  );

  static async productLevelPopup(): Promise<z.infer<typeof this.productLevelPopupResponseSchema>> {
    const response = await this.request('/product-level-popup.json');
    const productLevelPopup = this.productLevelPopupResponseSchema.parse(response);
    return productLevelPopup;
  }

  static relatedItemsResponseSchema = z.record(
    z.string(),
    z.array(z.string())
  );

  static async relatedItems(): Promise<z.infer<typeof this.relatedItemsResponseSchema>> {
    const response = await this.request('/related-items.json');
    const relatedItems = this.relatedItemsResponseSchema.parse(response);
    return relatedItems;
  }

  static promotionalBannersResponseSchema = z.array(
    z.object({
      countries: z.array(
        z.enum([
          "england",
          "wales",
          "scotland",
          "northern_ireland",
          "republic_of_ireland"
        ])
      ),
      campaign: z.string(),
      image_url: z.string().url(),
      start_at: z.string(),
      end_at: z.string(),
      url: z.string().url(),
      status: z.string()
    })
  );

  static async promotionalBanners(): Promise<z.infer<typeof this.promotionalBannersResponseSchema>> {
    const response = await this.request('/promotional-banners.json');
    const promotionalBanners = this.promotionalBannersResponseSchema.parse(response);
    return promotionalBanners;
  }

  static async appVersion(): Promise<string> {
    const response = await fetch(`${this.S3_API_ENDPOINT}/app-version.json`)
    return response.text();
  }

  static venueResponseSchema = z.object({
    id: z.number(),
    identifier: z.number(),
    sitecore_id: z.string().uuid().nullable(),
    brand: z.enum(["Wetherspoon", "Airport", "Lloyds", "Franchise", "Hotel"]).nullable(),
    zonal_site_id: z.number().nullable(),
    name: z.string(),
    address_line_1: z.string().nullable(),
    address_line_2: z.string().nullable(),
    town: z.string().nullable(),
    county: z.string().nullable(),
    post_code: z.string().nullable(),
    country_code: z.enum(["GB", "IE"]).nullable(),
    country: z.string().nullable(),
    station: z.string().nullable(),
    telephone: z.string().nullable(),
    latitude: z.string().nullable(),
    longitude: z.string().nullable(),
    email: z.string().nullable(),
    type: z.literal("pub"),
    is_closed: z.union([z.literal(0), z.literal(1)]),
    services: z.array(z.number()).nullable(),
    rear_menu_id: z.number().nullable(),
    thumbnail: z.string().nullable(),
    levels: z.array(z.unknown()).nullable(),
    facilities: z.array(z.string()),
    venue_can_order: z.union([z.literal(0), z.literal(1)]),
    special_promos: z.string().nullable(),
    locale: z.string().nullable(),
    can_place_order: z.union([z.literal(0), z.literal(1)]),
    table_bookings_taken: z.union([z.literal(0), z.literal(1)]),
    table_booking_url: z.string().nullable(),
    online_orders_taken: z.union([z.literal(0), z.literal(1)]),
    opening_times: z.union([
      z.object({
        days: z.object({
          fri: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          mon: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          sat: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          sun: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          thu: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          tue: z.object({ open: z.string(), close: z.string(), label: z.string() }),
          wed: z.object({ open: z.string(), close: z.string(), label: z.string() })
        }),
        dates: z.object({
          "01-01": z.object({ open: z.string(), close: z.string(), label: z.string() }),
          "24-12": z.object({ open: z.string(), close: z.string(), label: z.string() }),
          "25-12": z.object({ open: z.string(), close: z.string(), label: z.string() }),
          "26-12": z.object({ open: z.string(), close: z.string(), label: z.string() }),
          "30-12": z.object({ open: z.string(), close: z.string(), label: z.string() })
        }),
        notes: z.string(),
        additional: z.object({
          children: z.object({
            open: z.string(),
            close: z.string(),
            label: z.string(),
            eating: z.string()
          })
        })
      }),
      z.array(z.never())
    ]),
    temporary_closed: z.union([
      z.object({
        closureTo: z.string(),
        closureFrom: z.string(),
        closureNotice: z.string(),
        pubIsTemporaryClosed: z.boolean()
      }),
      z.array(z.never())
    ]),
    client_item_id: z.string().nullable(),
    gallery_url: z.array(z.string().url()),
    currency: z.object({
      currency_code: z.enum(["GBP", "EUR"]),
      currency_symbol: z.enum(["£", "€"]),
      currency_html_name: z.string(),
      currency_html_number: z.string()
    }).nullable(),
    iad_pricing: z.string().nullable(),
    iad_wine_pricing: z.string().nullable(),
    gluten_free_menu: z.unknown().nullable(), // TODO: Figure all of these out
    dairy_free_menu: z.unknown().nullable(),
    related_site: z.unknown().nullable(),
    payment: z.object({
      gateway: z.string().nullable(),
      bnpp: z.object({
        merchant_id: z.string(),
        apple_pay_merchant_id: z.string().nullable()
      }).optional(),
      braintree: z.object({
        apple_pay_merchant_id: z.string().nullable()
      }).optional(),
      payit: z.object({
        client_id: z.string().nullable(),
        enabled: z.union([z.literal(0), z.literal(1)])
      })
    }),
    mobile_ordering_enabled: z.boolean(),
    payment_methods_disabled: z.array(z.string())
  });

  static async venue(id: number): Promise<z.infer<typeof this.venueResponseSchema>> {
    const response = await this.request(`/pubs/${id}/venue.json`);
    const venue = this.venueResponseSchema.parse(response);
    return venue;
  }

  static tablesResponseSchema = z.array(
    z.object({
      table_number: z.number()
    })
  );

  static async tables(id: number): Promise<z.infer<typeof this.tablesResponseSchema>> {
    const response = await this.request(`/pubs/${id}/tables.json`);
    const tables = this.tablesResponseSchema.parse(response);
    return tables;
  }

  static alesResponseSchema = z.array(
    z.object({
      id: z.number(),
      identifier: z.string(),
      brewery: z.string(),
      product: z.string(),
      name: z.string(),
      brewer_product: z.string(),
      colour_code: z.string(),
      abv: z.string(),
      allergens: z.record(
        z.string(),
        z.string()
      ),
      units: z.string(),
      price_band: z.string(),
      product_description: z.string(),
      location: z.string(),
      est_date: z.string(),
      is_favourite: z.union([z.literal(0), z.literal(1)]),
      is_cellared: z.union([z.literal(0), z.literal(1)]),
      active_sales_areas: z.array(
        z.object({
          id: z.number()
        })
      )
    })
  );

  static async ales(id: number): Promise<z.infer<typeof this.alesResponseSchema>> {
    const response = await this.request(`/pubs/${id}/ales.json`);
    const ales = this.alesResponseSchema.parse(response);
    return ales;
  }

  static specialsResponseSchema = z.array(
    z.object({
      product_id: z.number(),
      discount: z.object({
        id: z.number(),
        name: z.string(),
        description: z.string(),
        discount_id: z.number(),
        discount_value: z.number()
      }),
      product_type: z.string()
    })
  );

  static async specials(id: number): Promise<z.infer<typeof this.specialsResponseSchema>> {
    const response = await this.request(`/pubs/${id}/specials.json`);
    const specials = this.specialsResponseSchema.parse(response);
    return specials;
  }

  static piksResponseSchema = z.union([
    z.object({
      Type: z.literal("Statistics"),
      Updated: z.string(),
      Data: z.object({
        Statistics: z.object({
          avgFood: z.number(),
          avgDrink: z.number()
        })
      }),
      Real: z.enum(["True", "False"])
    }),
    z.object({}),
  ]);

  static async piks(id: number): Promise<z.infer<typeof this.piksResponseSchema>> {
    const response = await this.request(`/pubs/${id}/piks.json`);
    const piks = this.piksResponseSchema.parse(response);
    return piks;
  }

  static outOfStockResponseSchema = z.array(
    z.number()
  );

  static async outOfStock(id: number): Promise<z.infer<typeof this.outOfStockResponseSchema>> {
    const response = await this.request(`/pubs/${id}/out-of-stock.json`);
    const outOfStock = this.outOfStockResponseSchema.parse(response);
    return outOfStock;
  }

  // This technically exists in the API but I can't find any existance of it
  static productLevelPopupByVenueResponseSchema = z.unknown();
  static async productLevelPopupByVenue(id: number): Promise<z.infer<typeof this.productLevelPopupByVenueResponseSchema>> {
    const response = await this.request(`/pubs/${id}/product-level-popup.json`);
    const productLevelPopupByVenue = this.productLevelPopupByVenueResponseSchema.parse(response);
    return productLevelPopupByVenue;
  }
}

