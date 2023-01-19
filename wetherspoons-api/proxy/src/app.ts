import { APIGatewayEvent } from 'aws-lambda';

export const handler = async (event: APIGatewayEvent ) => {
    console.log(event);
    return event;
}