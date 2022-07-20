
import { model, ObjectExpression, Schema } from 'mongoose';

interface Venue {
    name: String,
    id: Number,
}

export interface DrinkType {
    timestamp: Date,
    name: String,
    venue: Venue
    price: Number,
}

const DrinkSchema = new Schema<DrinkType>(
    {
        timestamp: {
            type: Date,
            required: true,
        },
            name: {
                type: String,
                required: true,
            },
            venue: {
                name: {
                    type: String,
                    required: true,
                },
                id: {
                    type: Number,
                    required: true,
                }
            },
        price: { 
            type: Number,
            required: true,
        }
    },
);

export default model('Drink', DrinkSchema, 'drinks');