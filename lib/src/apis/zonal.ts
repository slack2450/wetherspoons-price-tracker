import { object, z } from "zod";

interface ZonalRequest {
  method: string;
  siteId?: number;
  menuId?: number;
  salesAreaId?: number;
}

export class WetherspoonsZonalAPI {
  static ZONAL_API_ENDPOINT = 'https://zc.ca.jdw-apps.net/api/iorder';
  static ZONAL_PUBLIC_API_KEY = 'SH0obBv23pj7lUrg5SESDdJO8fS9p0ND';
  static ZONAL_REQUEST_DEFAULTS = {
    platform: "nintendo-ds",
    bundleIdentifier: "com.stella.enjoyers",
    userDeviceIdentifier: "i-love-drinking-beer",
    version: "1.0.0",
  }

  static async request(params: ZonalRequest): Promise<any> {
    const form = new FormData();
    form.append(
      'request',
      JSON.stringify(
        {
          'request': { ...this.ZONAL_REQUEST_DEFAULTS, ...params }
        }
      )
    );

    const response = await fetch(this.ZONAL_API_ENDPOINT,
      {
        headers: {
          'x-api-key': this.ZONAL_PUBLIC_API_KEY,
        },
        body: form,
        method: 'POST'
      }
    );

    const text = await response.text();

    const json = JSON.parse(text);

    return await json;
  }

  static venuesResponseSchema = z.object({
    response: z.string(),
    count: z.number(),
    supportsLoyalty: z.unknown(),
    services: z.unknown(),
    platform: z.string(),
    rearMenu: z.unknown(),
    cached_at: z.string(),
    venues: z.array(
      z.object({
        displayImages: z.array(z.unknown()),
        venueRef: z.string(),
        specialPromos: z.array(z.unknown()),
        rearMenuId: z.number(),
        feedbackURL: z.string(),
        externalLinks: z.array(z.unknown()),
        manager: z.string(),
        services: z.array(z.number()),
        locale: z.string(),
        displayImage: z.string(),
        comingSoon: z.union([z.literal(0), z.literal(1)]),
        levels: z.array(z.unknown()),
        thumbNail: z.string(),
        salesArea: z.array(
          z.object({
            canOrder: z.union([z.literal(0), z.literal(1)]),
            telephoneNumber: z.string(),
            location: z.object({
              longitude: z.union([
                z.number(),
                z.string(),
              ]),
              latitude: z.union([
                z.number(),
                z.string(),
              ]),
              distanceTolerance: z.number(),
            }),
            services: z.array(z.number()),
            friendly: z.string(),
            images: z.array(
              z.object({
                url: z.string(),
                id: z.string(),
                altText: z.string()
              })
            ),
            name: z.string(),
            id: z.number(),
            canChargeToRoom: z.union([z.literal(0), z.literal(1)]),
            canPlaceOrder: z.union([z.literal(0), z.literal(1)]),
            description: z.string()
          })
        ),
        name: z.string(),
        id: z.number(),
        thumbNailImage: z.object({
          url: z.string(),
          altText: z.string()
        }),
        about: z.string(),
        standardDisplayImage: z.object({
          url: z.string(),
          altText: z.string()
        }),
        venueCanOrder: z.union([z.literal(0), z.literal(1)]),
        currency: z.object({
          symbol: z.string(),
          countryCode: z.string(),
          htmlNumber: z.string(),
          code: z.string(),
          htmlName: z.string(),
          currencyCode: z.string()
        }),
        canPlaceOrder: z.union([z.literal(0), z.literal(1)]),
        social: z.object({
          snapchat: z.string(),
          googleplus: z.string(),
          instagram: z.string(),
          twitter: z.string(),
          facebook: z.string()
        }),
        contactDetails: z.object({
          telephone: z.string(),
          website: z.string(),
          email: z.string()
        }),
        address: z.object({
          county: z.string(),
          line1: z.string(),
          country: z.object({
            code: z.string(),
            name: z.string()
          }),
          location: z.object({
            longitude: z.union([
              z.number(),
              z.string(),
            ]),
            latitude: z.union([
              z.number(),
              z.string(),
            ]),
            distanceTolerance: z.number()
          }),
          line3: z.string(),
          town: z.string(),
          postcode: z.string(),
          line2: z.string()
        })
      })
    )
  })

  static async venues(): Promise<z.infer<typeof this.venuesResponseSchema>> {
    const response = await this.request({
      method: 'venues'
    });
    const venues = this.venuesResponseSchema.parse(response);
    return venues;
  }

  static getMenusResponseSchema = z.object({
    response: z.literal("OK"),
    menus: z.array(
      z.object({
        canOrder: z.union([z.literal(0), z.literal(1)]),
        standardImage: z.object({
          url: z.string(),
          altText: z.string()
        }),
        created: z.string(),
        menuCategoryDisabled: z.union([z.literal(0), z.literal(1)]),
        customField: z.string(),
        updated: z.string(),
        image: z.string(),
        name: z.string(),
        id: z.number(),
        versionId: z.number(),
        squareImageURL: z.string(),
        description: z.string(),
        sortOrder: z.number(),
        squareImage: z.object({
          url: z.string(),
          altText: z.string()
        }),
        salesAreaId: z.number()
      })
    ),
    count: z.number(),
    layoutType: z.enum(["banner"]), // Add other layout types if needed
    courses: z.array(
      z.object({
        displayName: z.string(),
        id: z.number(),
        sortOrder: z.number()
      })
    ),
    showWaitTime: z.boolean(),
    waitTime: z.number(),
    platform: z.string(),
    hasAztecCourses: z.union([z.literal(0), z.literal(1)]),
    canPlaceOrder: z.union([z.literal(0), z.literal(1)]),
    cached_at: z.string()
  });

  // This API will back you off giving a 403 if you spam it
  static async getMenus({ siteId, salesAreaId }: { siteId: number, salesAreaId: number }): Promise<z.infer<typeof this.getMenusResponseSchema>> {
    const response = await this.request({
      method: 'getMenus',
      siteId,
      salesAreaId
    });
    const getMenus = this.getMenusResponseSchema.parse(response);
    return getMenus;
  }

  static getMenuPagesResponseSchema = z.object({
    canOrder: z.union([z.literal(0), z.literal(1)]),
    showWaitTime: z.boolean(),
    waitTime: z.number(),
    canPlaceOrder: z.union([z.literal(0), z.literal(1)]),
    aztec: z.object({
      choiceGroups: z.array(
        z.object({
          portionRatios: z.array(
            z.object({
              productId: z.number(),
              child: z.number(),
              parent: z.number(),
              ratio: z.number()
            })
          ),
          defaults: z.array(z.unknown()),
          choices: z.array(
            z.object({
              productId: z.number().optional(),
              displayRecords: z.array(
                z.object({
                  choiceDisplayRecordId: z.number(),
                  productDisplayRecordId: z.number()
                })
              )
            })
          ),
          id: z.number(),
          name: z.string(),
          displayRecords: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              description: z.string(),
              image: z.string().optional(),
              alt_text: z.string().nullable().optional(),
              keywords: z.array(z.number()).optional(),
              productParentId: z.string().optional(),
            })
          )
        })
      ),
      divisions: z.array(
        z.object({
          id: z.number(),
          canPayOnBarAccount: z.enum(["YES", "NO"]),
          canSaveOnBarAccount: z.enum(["YES", "NO"])
        })
      ),
      products: z.array(
        z.object({
          id: z.number(),
          eposName: z.string(),
          displayRecords: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              description: z.string(),
              effectiveDate: z.string().optional(),
              expiryDate: z.string().optional(),
              image: z.string().optional(),
              alt_text: z.string().nullable().optional(),
              keywords: z.array(z.number()).optional(),
              calories: z.number().optional(),
              mayStock: z.number().optional(),
              showPrices: z.number().optional()
            })
          ),
          showCourseDialog: z.union([z.literal(0), z.literal(1)]),
          defaultCourseId: z.number(),
          portions: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              portion_name: z.string().nullable().optional(),
              description: z.union([z.string(), z.undefined(), z.null(), z.number()]),
              calories: z.number().nullable().optional(),
              choices: z.array(
                z.object({
                  choiceId: z.number(),
                  portionId: z.number(),
                  displayRecordId: z.number().optional(),
                  productParentId: z.string().optional(),
                  displayRecords: z.object({
                    productDisplayRecordId: z.number(),
                    choiceDisplayRecordId: z.number(),
                  }).optional(),
                })
              ),
              price: z.number().optional(),
              supplementPrice: z.number().optional()
            })
          ),
          isInstruction: z.number().optional(),
          categoryId: z.number().optional(),
          subcategoryId: z.number().optional(),
          divisionId: z.number().optional(),
          isOutOfStock: z.union([z.literal(0), z.literal(1)]).optional()
        })
      )
    }),
    display: z.object({
      displayGroups: z.array(
        z.object({
          groupId: z.number(),
          groupName: z.string(),
          groupHeader: z.string(),
          groupFooter: z.string(),
          groupImage: z.string(),
          sortOrder: z.number(),
          items: z.array(
            z.union([
              z.object({
                itemType: z.literal("textField"),
                selectedSalesAreas: z.string(),
                sortOrder: z.number(),
                itemId: z.number(),
                textField: z.object({
                  text: z.string()
                })
              }),
              z.object({
                itemType: z.literal("subHeader"),
                selectedSalesAreas: z.string(),
                sortOrder: z.number(),
                itemId: z.number(),
                subHeader: z.object({
                  text: z.string()
                })
              }),
              z.object({
                itemType: z.literal("hyperlink"),
                selectedSalesAreas: z.string(),
                sortOrder: z.number(),
                itemId: z.number(),
                uiSpecificData: z.object({
                  hyperlinkType: z.string(),
                  hyperlinkMenuValue: z.number(),
                  hyperlinkGroupValue: z.number(),
                  hyperlinkItemValue: z.string()
                }),
                hyperlink: z.object({
                  image: z.object({
                    imageURL: z.string()
                  }),
                  text: z.string(),
                  link: z.string()
                })
              }),
              z.object({
                itemType: z.literal("product"),
                selectedSalesAreas: z.string(),
                sortOrder: z.number(),
                itemId: z.number(),
                product: z.object({
                  productId: z.number(),
                  displayName: z.string(),
                  displayRecordId: z.number(),
                  defaultPortionId: z.number().optional(),
                  controlPortions: z.number().optional(),
                  showPortions: z.array(z.unknown()).optional(),
                  choices: z.array(
                    z.object({
                      productId: z.number(),
                      productParentId: z.string().optional(),
                      displayRecords: z.object({
                        productDisplayRecordId: z.number(),
                        choiceDisplayRecordId: z.number()
                      })
                    }).optional()
                  ),
                  showPrices: z.number(),
                  mayStock: z.number(),
                })
              })
            ])
          )
        })
      ),
      keywords: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          iconUrl: z.string().url().optional()
        })
      )
    }),
    displayGroupUpsells: z.array(z.unknown()).optional(),
    response: z.literal("OK"),
    menuCategoryDisabled: z.number().optional(),
    cached_at: z.string().optional()
  }).or(
    // Often Cache miss meaning it doesn't exist
    z.object({
      message: z.string(),
    }),
  );

  static async getMenuPages({ siteId, salesAreaId, menuId }: { siteId: number, salesAreaId: number, menuId: number }): Promise<z.infer<typeof this.getMenuPagesResponseSchema>> {
    const response = await this.request({
      method: 'getMenuPages',
      siteId,
      salesAreaId,
      menuId
    });
    const getMenuPages = this.getMenuPagesResponseSchema.parse(response);
    return getMenuPages;
  }
}
