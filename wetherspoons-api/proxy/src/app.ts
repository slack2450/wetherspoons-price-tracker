import { APIGatewayEvent } from 'aws-lambda';

export const handler = async (event: APIGatewayEvent ) => {
    return event.pathParameters;
}